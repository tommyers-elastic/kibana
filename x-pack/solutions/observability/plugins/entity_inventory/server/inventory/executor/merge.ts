/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { InventorySource } from '@kbn/entity-store/common';
import {
  ENTITY_ID_COLUMN,
  LAST_SEEN_COLUMN,
  type InventoryColumn,
  type InventoryColumnKind,
  type InventoryProvenance,
  type InventoryRow,
  type InventorySort,
} from '../../../common';

/**
 * Maps a per-source attribute's raw values to canonical labels on the aggregated rows. A raw
 * value without an entry passes through as its string form (nothing is hidden); nulls stay null.
 */
export const applyValueLabels = (rows: InventoryRow[], source: InventorySource): InventoryRow[] => {
  const labelled = (source.attributes ?? []).filter((attribute) => attribute.valueLabels);
  if (labelled.length === 0) {
    return rows;
  }
  return rows.map((row) => {
    const next = { ...row };
    for (const { name, valueLabels } of labelled) {
      const raw = next[name];
      if (raw === null || raw === undefined || !valueLabels) {
        continue;
      }
      const key = String(raw);
      next[name] = valueLabels[key] ?? key;
    }
    return next;
  });
};

const isNull = (value: unknown): boolean => value === null || value === undefined;

const lastSeenOf = (row: InventoryRow): string => {
  const value = row[LAST_SEEN_COLUMN];
  return typeof value === 'string' ? value : '';
};

/** One source's rows, in the definition's source order. */
export interface MergeInput {
  index: string;
  rows: InventoryRow[];
}

export interface MergeResult {
  rows: InventoryRow[];
  provenance: InventoryProvenance;
}

/**
 * Merges per-source rows by `entity.id`. An entity exists if any source saw it. Per column:
 *
 * - **metrics**: the first source in definition order with a non-null value wins. Both sources
 *   describe the same window, so "which scraped last" is arbitrary; declaration order is explicit
 *   and stable, and authors control it by ordering sources.
 * - **attributes**: the source with the newest `last_seen` wins (mutable state such as phase).
 * - identity and `entity.id`: first non-null; `last_seen`: the newest of all.
 *
 * A null never overrides a value. `provenance` records which source supplied every merged metric
 * and attribute. Rows of one source that share an id (a ranked identity whose documents differ in
 * which ranking fields they carry) merge the same way.
 */
export const mergeRows = (inputs: MergeInput[], columns: InventoryColumn[]): MergeResult => {
  const kinds = new Map(columns.map(({ name, kind }) => [name, kind]));
  const merged = new Map<string, InventoryRow>();
  const provenance: InventoryProvenance = {};
  for (const { index, rows } of inputs) {
    for (const row of rows) {
      const id = row[ENTITY_ID_COLUMN];
      if (typeof id !== 'string') {
        continue;
      }
      const existing = merged.get(id);
      if (!existing) {
        merged.set(id, { ...row });
        provenance[id] = Object.fromEntries(
          Object.entries(row)
            .filter(([column, value]) => !isNull(value) && isSourced(kinds.get(column)))
            .map(([column]) => [column, index])
        );
        continue;
      }
      const incomingIsNewer = lastSeenOf(row) > lastSeenOf(existing);
      for (const [column, value] of Object.entries(row)) {
        if (isNull(value)) {
          continue;
        }
        const kind = kinds.get(column);
        if (column === LAST_SEEN_COLUMN) {
          if (incomingIsNewer) {
            existing[column] = value;
          }
          continue;
        }
        const takeIncoming = isNull(existing[column]) || (kind === 'attribute' && incomingIsNewer);
        if (takeIncoming) {
          existing[column] = value;
          if (isSourced(kind)) {
            provenance[id][column] = index;
          }
        }
      }
    }
  }
  return { rows: [...merged.values()], provenance };
};

const isSourced = (kind: InventoryColumnKind | undefined): boolean =>
  kind === 'attribute' || kind === 'metric';

const compareValues = (a: unknown, b: unknown): number => {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
};

/** Stable sort on one column; nulls last regardless of direction, ties broken by `entity.id`. */
export const sortRows = (
  rows: InventoryRow[],
  { column, direction }: InventorySort
): InventoryRow[] => {
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = a[column];
    const vb = b[column];
    const aNull = isNull(va);
    const bNull = isNull(vb);
    if (aNull && bNull) {
      return compareValues(a[ENTITY_ID_COLUMN], b[ENTITY_ID_COLUMN]);
    }
    if (aNull) {
      return 1;
    }
    if (bNull) {
      return -1;
    }
    const order = compareValues(va, vb) * sign;
    return order !== 0 ? order : compareValues(a[ENTITY_ID_COLUMN], b[ENTITY_ID_COLUMN]);
  });
};
