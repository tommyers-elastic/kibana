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
  type InventoryTimeSeriesPoint,
} from '../../../common';
import { mergeRows, sortRows, type MergeInput, type MergeResult } from './merge';

/** Separates detail summaries from metric buckets, preserving source priority within each bucket. */
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
  const points = new Map<string, InventoryTimeSeriesPoint>();
  for (const { rows } of inputs) {
    for (const row of rows) {
      const entityId = row[ENTITY_ID_COLUMN];
      const timestamp = row[bucketColumn];
      if (typeof entityId !== 'string' || typeof timestamp !== 'string') {
        continue;
      }
      const key = JSON.stringify([entityId, timestamp]);
      const point = points.get(key) ?? {
        entityId,
        timestamp,
        metrics: Object.fromEntries(metricColumns.map(({ name }) => [name, null])),
      };
      for (const { name } of metricColumns) {
        const value = row[name];
        if (point.metrics[name] === null && typeof value === 'number' && Number.isFinite(value)) {
          point.metrics[name] = value;
        }
      }
      points.set(key, point);
    }
  }
  return {
    ...mergeRows(summaryInputs, summaryColumns),
    points: [...points.values()].sort(
      (left, right) =>
        left.timestamp.localeCompare(right.timestamp) || left.entityId.localeCompare(right.entityId)
    ),
  };
};
