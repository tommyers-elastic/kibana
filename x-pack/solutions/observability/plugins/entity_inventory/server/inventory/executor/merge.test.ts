/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { applyValueLabels, mergeRows, sortRows } from './merge';

describe('mergeRows', () => {
  it('merges by entity.id: newest last_seen wins per column, nulls never override, last_seen is the max', () => {
    const otel = [
      {
        'entity.id': 'k8s.pod:a',
        name: 'a',
        cpu: 1,
        phase: null,
        last_seen: '2026-09-16T08:44:00.000Z',
      },
      {
        'entity.id': 'k8s.pod:b',
        name: 'b',
        cpu: 2,
        phase: null,
        last_seen: '2026-09-16T08:40:00.000Z',
      },
    ];
    const state = [
      {
        'entity.id': 'k8s.pod:a',
        name: 'a-newer',
        cpu: null,
        phase: 'running',
        last_seen: '2026-09-16T08:44:30.000Z',
      },
      {
        'entity.id': 'k8s.pod:c',
        name: 'c',
        cpu: null,
        phase: 'succeeded',
        last_seen: '2026-09-16T08:30:00.000Z',
      },
    ];
    const merged = mergeRows([otel, state]);
    expect(merged).toEqual([
      {
        'entity.id': 'k8s.pod:a',
        name: 'a-newer',
        cpu: 1,
        phase: 'running',
        last_seen: '2026-09-16T08:44:30.000Z',
      },
      {
        'entity.id': 'k8s.pod:b',
        name: 'b',
        cpu: 2,
        phase: null,
        last_seen: '2026-09-16T08:40:00.000Z',
      },
      {
        'entity.id': 'k8s.pod:c',
        name: 'c',
        cpu: null,
        phase: 'succeeded',
        last_seen: '2026-09-16T08:30:00.000Z',
      },
    ]);
  });

  it('keeps the newer value when an older source arrives second', () => {
    const merged = mergeRows([
      [{ 'entity.id': 'x', v: 'new', last_seen: '2026-09-16T09:00:00.000Z' }],
      [{ 'entity.id': 'x', v: 'old', last_seen: '2026-09-16T08:00:00.000Z' }],
    ]);
    expect(merged).toEqual([{ 'entity.id': 'x', v: 'new', last_seen: '2026-09-16T09:00:00.000Z' }]);
  });

  it('drops rows without an entity id', () => {
    expect(mergeRows([[{ 'entity.id': null, v: 1 }]])).toEqual([]);
  });
});

describe('sortRows', () => {
  const rows = [
    { 'entity.id': 'b', cpu: 2 },
    { 'entity.id': 'a', cpu: null },
    { 'entity.id': 'c', cpu: 1 },
    { 'entity.id': 'd', cpu: 2 },
  ];
  it('sorts with nulls last in both directions and breaks ties by entity.id', () => {
    expect(sortRows(rows, { column: 'cpu', direction: 'asc' }).map((r) => r['entity.id'])).toEqual([
      'c',
      'b',
      'd',
      'a',
    ]);
    expect(sortRows(rows, { column: 'cpu', direction: 'desc' }).map((r) => r['entity.id'])).toEqual(
      ['b', 'd', 'c', 'a']
    );
  });
  it('sorts strings and ISO dates lexicographically', () => {
    const dated = [
      { 'entity.id': 'x', last_seen: '2026-09-16T08:00:00.000Z' },
      { 'entity.id': 'y', last_seen: '2026-09-16T09:00:00.000Z' },
    ];
    expect(sortRows(dated, { column: 'last_seen', direction: 'desc' })[0]['entity.id']).toBe('y');
  });
});

describe('applyValueLabels', () => {
  const source = {
    index: 'x',
    attributes: [{ name: 'phase', field: 'k8s.pod.phase', valueLabels: { '2': 'running' } }],
  };
  it('maps labelled values, passes unknown raw values through as strings and keeps nulls', () => {
    expect(
      applyValueLabels([{ phase: 2 }, { phase: 7 }, { phase: null }, { phase: 'Running' }], source)
    ).toEqual([{ phase: 'running' }, { phase: '7' }, { phase: null }, { phase: 'Running' }]);
  });
  it('is a no-op for sources without labels', () => {
    const rows = [{ phase: 2 }];
    expect(
      applyValueLabels(rows, { index: 'x', attributes: [{ name: 'phase', field: 'f' }] })
    ).toBe(rows);
  });
});
