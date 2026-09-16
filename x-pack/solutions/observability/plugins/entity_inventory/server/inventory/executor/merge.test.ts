/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { InventoryColumn } from '../../../common';
import { applyValueLabels, mergeRows, sortRows } from './merge';

describe('mergeRows', () => {
  const columns: InventoryColumn[] = [
    { name: 'entity.id', kind: 'entity_id' },
    { name: 'kubernetes.pod.uid', kind: 'identity' },
    { name: 'name', kind: 'attribute' },
    { name: 'phase', kind: 'attribute' },
    { name: 'cpu', kind: 'metric' },
    { name: 'last_seen', kind: 'last_seen' },
  ];

  it('metrics: first source in definition order wins; attributes: newest last_seen wins; last_seen: max', () => {
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
    const ecs = [
      {
        'entity.id': 'k8s.pod:a',
        name: 'a-newer',
        cpu: 1.1,
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
    const { rows, provenance } = mergeRows(
      [
        { index: 'otel', rows: otel },
        { index: 'ecs', rows: ecs },
      ],
      columns
    );
    expect(rows).toEqual([
      // cpu stays 1 (otel declared first) even though ecs is newer; name and phase follow the newer source.
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
    expect(provenance).toEqual({
      'k8s.pod:a': { name: 'ecs', cpu: 'otel', phase: 'ecs' },
      'k8s.pod:b': { name: 'otel', cpu: 'otel' },
      'k8s.pod:c': { name: 'ecs', phase: 'ecs' },
    });
  });

  it('a null in the preferred source never masks a value from a later one', () => {
    const { rows, provenance } = mergeRows(
      [
        {
          index: 'first',
          rows: [{ 'entity.id': 'x', cpu: null, last_seen: '2026-09-16T09:00:00.000Z' }],
        },
        {
          index: 'second',
          rows: [{ 'entity.id': 'x', cpu: 5, last_seen: '2026-09-16T08:00:00.000Z' }],
        },
      ],
      columns
    );
    expect(rows).toEqual([{ 'entity.id': 'x', cpu: 5, last_seen: '2026-09-16T09:00:00.000Z' }]);
    expect(provenance).toEqual({ x: { cpu: 'second' } });
  });

  it('keeps the newer attribute when an older source arrives second', () => {
    const { rows } = mergeRows(
      [
        {
          index: 'a',
          rows: [{ 'entity.id': 'x', name: 'new', last_seen: '2026-09-16T09:00:00.000Z' }],
        },
        {
          index: 'b',
          rows: [{ 'entity.id': 'x', name: 'old', last_seen: '2026-09-16T08:00:00.000Z' }],
        },
      ],
      columns
    );
    expect(rows).toEqual([
      { 'entity.id': 'x', name: 'new', last_seen: '2026-09-16T09:00:00.000Z' },
    ]);
  });

  it('drops rows without an entity id', () => {
    expect(
      mergeRows([{ index: 'a', rows: [{ 'entity.id': null, cpu: 1 }] }], columns).rows
    ).toEqual([]);
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
