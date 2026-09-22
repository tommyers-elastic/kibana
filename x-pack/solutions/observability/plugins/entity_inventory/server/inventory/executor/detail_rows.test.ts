/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { InventoryColumn } from '../../../common';
import { mergeDetailRows } from './detail_rows';

const columns: InventoryColumn[] = [
  { name: 'entity.id', kind: 'entity_id' },
  { name: 'name', kind: 'attribute' },
  { name: 'phase', kind: 'attribute' },
  { name: 'cpu', kind: 'metric' },
  { name: 'memory', kind: 'metric' },
  { name: 'last_seen', kind: 'last_seen' },
];

describe('mergeDetailRows', () => {
  it('merges metrics per entity and bucket with source priority, preserves nulls and omits metric summaries', () => {
    const merged = mergeDetailRows(
      [
        {
          index: 'preferred',
          rows: [
            {
              'entity.id': 'a',
              bucket: '2026-09-22T00:01:00.000Z',
              cpu: 2,
              last_seen: '2026-09-22T00:01:30.000Z',
              name: 'new',
              phase: null,
            },
            {
              'entity.id': 'a',
              bucket: '2026-09-22T00:00:00.000Z',
              cpu: null,
              memory: 0,
              last_seen: '2026-09-22T00:00:30.000Z',
              name: 'old',
              phase: 'running',
            },
          ],
        },
        {
          index: 'fallback',
          rows: [
            {
              'entity.id': 'a',
              bucket: '2026-09-22T00:00:00.000Z',
              cpu: 1,
              memory: 99,
              last_seen: '2026-09-22T00:00:20.000Z',
            },
            {
              'entity.id': 'a',
              bucket: '2026-09-22T00:01:00.000Z',
              cpu: 999,
              last_seen: '2026-09-22T00:01:20.000Z',
            },
            {
              'entity.id': 'b',
              bucket: '2026-09-22T00:01:00.000Z',
              cpu: 3,
              memory: Infinity,
              last_seen: '2026-09-22T00:01:20.000Z',
            },
          ],
        },
        {
          index: 'attributes',
          rows: [{ 'entity.id': 'a', name: 'newest', last_seen: '2026-09-22T00:02:00.000Z' }],
        },
      ],
      columns,
      'bucket'
    );
    expect(merged.points).toEqual([
      { entityId: 'a', timestamp: '2026-09-22T00:00:00.000Z', metrics: { cpu: 1, memory: 0 } },
      { entityId: 'a', timestamp: '2026-09-22T00:01:00.000Z', metrics: { cpu: 2, memory: null } },
      { entityId: 'b', timestamp: '2026-09-22T00:01:00.000Z', metrics: { cpu: 3, memory: null } },
    ]);
    expect(merged.rows[0]).toEqual({
      'entity.id': 'a',
      name: 'newest',
      phase: 'running',
      last_seen: '2026-09-22T00:02:00.000Z',
    });
    expect(merged.provenance.a).toEqual({ name: 'attributes', phase: 'preferred' });
  });
});
