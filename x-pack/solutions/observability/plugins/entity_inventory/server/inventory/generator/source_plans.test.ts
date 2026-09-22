/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { InventorySource } from '@kbn/entity-store/common';
import { InventoryDefinitionError, planSources } from '.';

const cpu = { name: 'cpu', field: 'system.cpu.utilization', agg: 'avg' as const };
const mem = { name: 'mem', field: 'system.memory.utilization', agg: 'avg' as const };
const load = { name: 'load', field: 'system.cpu.load_average.1m', agg: 'avg' as const };

describe('planSources', () => {
  it('returns a source whose metrics declare no filter untouched', () => {
    const sources: InventorySource[] = [
      { index: 'metrics-*', filter: 'metricset.name == "cpu"', metrics: [cpu, mem] },
      { index: 'logs-*' },
    ];
    expect(planSources(sources)).toEqual(sources);
    // The same objects, so a definition without filtered metrics cannot generate different queries.
    expect(planSources(sources)[0]).toBe(sources[0]);
  });

  it('splits one plan per distinct filter, unfiltered metrics together, in first-appearance order', () => {
    expect(
      planSources([
        {
          index: 'metrics-*',
          metrics: [
            { ...cpu, filter: 'state == "idle"' },
            load,
            { ...mem, filter: 'state == "used"' },
            { name: 'cpu_user', field: 'system.cpu.utilization', agg: 'avg', filter: 'state == "idle"' },
          ],
        },
      ])
    ).toEqual([
      {
        index: 'metrics-*',
        filter: 'state == "idle"',
        metrics: [cpu, { name: 'cpu_user', field: 'system.cpu.utilization', agg: 'avg' }],
      },
      { index: 'metrics-*', metrics: [load] },
      { index: 'metrics-*', filter: 'state == "used"', metrics: [mem] },
    ]);
  });

  it('conjoins the source filter with the metric filter and keeps attributes on every plan', () => {
    expect(
      planSources([
        {
          index: 'metrics-*',
          filter: 'metricset.name == "cpu"',
          attributes: [{ name: 'os', field: 'host.os.name' }],
          metrics: [{ ...cpu, filter: 'state == "idle"' }, load],
        },
      ])
    ).toEqual([
      {
        index: 'metrics-*',
        filter: '(metricset.name == "cpu") AND (state == "idle")',
        attributes: [{ name: 'os', field: 'host.os.name' }],
        metrics: [cpu],
      },
      {
        index: 'metrics-*',
        filter: 'metricset.name == "cpu"',
        attributes: [{ name: 'os', field: 'host.os.name' }],
        metrics: [load],
      },
    ]);
  });

  it('groups filters that differ only in formatting, keeping the first spelling', () => {
    const plans = planSources([
      {
        index: 'metrics-*',
        metrics: [
          { ...cpu, filter: 'state == "idle"' },
          { ...mem, filter: 'state=="idle"' },
          { ...load, filter: '(state == "idle")' },
        ],
      },
    ]);
    expect(plans).toHaveLength(1);
    expect(plans[0].filter).toBe('state == "idle"');
    expect(plans[0].metrics).toEqual([cpu, mem, load]);
  });

  it('rejects a metric filter that could escape its WHERE, naming the metric', () => {
    expect(() =>
      planSources([
        { index: 'metrics-*', metrics: [{ ...cpu, filter: 'state == "idle" | LIMIT 1' }] },
      ])
    ).toThrow(InventoryDefinitionError);
    expect(() =>
      planSources([
        { index: 'metrics-*', metrics: [{ ...cpu, filter: 'state == "idle" | LIMIT 1' }] },
      ])
    ).toThrow('filter of metric "cpu" contains a pipe');
    expect(() =>
      planSources([{ index: 'metrics-*', metrics: [{ ...cpu, filter: 'state ==' }] }])
    ).toThrow('filter of metric "cpu" does not parse');
  });
});
