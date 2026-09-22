/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  ENTITY_ID_COLUMN,
  LAST_SEEN_COLUMN,
  type InventoryColumn,
  type InventoryProvenance,
  type InventoryTimeSeriesPoint,
} from '../../../common';
import { mergeRows, sortRows, type MergeInput, type MergeResult } from './merge';

/**
 * Separates detail summaries from buckets, choosing one source per entity and metric for the
 * window. `provenance` names that source alongside the summary attributes.
 */
export const mergeDetailRows = (
  inputs: MergeInput[],
  columns: InventoryColumn[],
  bucketColumn: string
): MergeResult & { points: InventoryTimeSeriesPoint[] } => {
  const summaryColumns = columns.filter(({ kind }) => kind !== 'metric');
  const metricColumns = columns.filter(({ kind }) => kind === 'metric');
  const summaryInputs = inputs.map(({ index, rows }) => ({
    index,
    // Fold a source's buckets oldest first so each attribute retains its latest non-null value.
    rows: mergeRows(
      [
        {
          index,
          rows: sortRows(rows, { column: LAST_SEEN_COLUMN, direction: 'asc' }).map((row) =>
            Object.fromEntries(summaryColumns.map(({ name }) => [name, row[name] ?? null]))
          ),
        },
      ],
      summaryColumns
    ).rows,
  }));
  // Select across the whole window before merging: a missing bucket never switches sources.
  const selectedSources = new Map<string, Map<string, number>>();
  for (const [sourceIndex, { rows }] of inputs.entries()) {
    for (const row of rows) {
      const entityId = row[ENTITY_ID_COLUMN];
      if (typeof entityId !== 'string' || typeof row[bucketColumn] !== 'string') continue;
      const selected = selectedSources.get(entityId) ?? new Map<string, number>();
      for (const { name } of metricColumns) {
        const value = row[name];
        if (!selected.has(name) && typeof value === 'number' && Number.isFinite(value)) {
          selected.set(name, sourceIndex);
        }
      }
      selectedSources.set(entityId, selected);
    }
  }
  const points = new Map<string, InventoryTimeSeriesPoint>();
  for (const [sourceIndex, { rows }] of inputs.entries()) {
    for (const row of rows) {
      const entityId = row[ENTITY_ID_COLUMN];
      const timestamp = row[bucketColumn];
      if (typeof entityId !== 'string' || typeof timestamp !== 'string') {
        continue;
      }
      const sourceMetrics = metricColumns.filter(
        ({ name }) => selectedSources.get(entityId)?.get(name) === sourceIndex
      );
      if (sourceMetrics.length === 0) continue;
      const key = JSON.stringify([entityId, timestamp]);
      const point = points.get(key) ?? {
        entityId,
        timestamp,
        metrics: Object.fromEntries(metricColumns.map(({ name }) => [name, null])),
      };
      for (const { name } of sourceMetrics) {
        const value = row[name];
        if (point.metrics[name] === null && typeof value === 'number' && Number.isFinite(value)) {
          point.metrics[name] = value;
        }
      }
      points.set(key, point);
    }
  }
  const summary = mergeRows(summaryInputs, summaryColumns);
  const provenance: InventoryProvenance = { ...summary.provenance };
  for (const [entityId, selected] of selectedSources) {
    if (selected.size === 0) continue;
    provenance[entityId] = {
      ...provenance[entityId],
      ...Object.fromEntries(
        [...selected].map(([name, sourceIndex]) => [name, inputs[sourceIndex].index])
      ),
    };
  }
  return {
    rows: summary.rows,
    provenance,
    points: [...points.values()].sort(
      (left, right) =>
        left.timestamp.localeCompare(right.timestamp) || left.entityId.localeCompare(right.entityId)
    ),
  };
};
