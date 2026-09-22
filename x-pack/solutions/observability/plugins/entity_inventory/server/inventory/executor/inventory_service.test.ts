/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core/server';
import type { Logger } from '@kbn/logging';
import type { EntityDefinitionRegistry } from '@kbn/entity-store/server';
import type { ESQLSearchResponse } from '@kbn/es-types';
import {
  RANGE,
  hostDefinition,
  hostFilteredMetricsDefinition,
  podDefinition,
  deploymentDefinition,
} from '../__fixtures__/definitions';
import { InventoryService } from './inventory_service';
import { InventoryRequestError, InventoryTypeNotFoundError } from './errors';
import { SourceMetadataResolver } from './source_metadata';

const logger = { warn: jest.fn(), debug: jest.fn() } as unknown as Logger;

type Responder = (query: string) => ESQLSearchResponse | Error;

const table = (
  rows: Array<Record<string, unknown>>,
  took = 5,
  documentsFound = 100
): ESQLSearchResponse => {
  const names = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return {
    took,
    documents_found: documentsFound,
    columns: names.map((name) => ({
      name,
      type: typeof rows[0]?.[name] === 'number' ? 'double' : 'keyword',
    })),
    values: rows.map((row) => names.map((name) => row[name] ?? null)),
  } as ESQLSearchResponse;
};

const fakeEs = (respond: Responder, modes: Record<string, string>, mapped: string[]) => {
  const esql = {
    query: jest.fn(async ({ query }: { query: string }) => {
      const result = respond(query);
      if (result instanceof Error) {
        throw result;
      }
      return result;
    }),
  };
  const indices = {
    getSettings: jest.fn(async ({ index }: { index: string }) =>
      modes[index]
        ? {
            [`.ds-${index}-1`]:
              modes[index] === 'standard'
                ? { settings: {}, defaults: { index: { mode: 'standard' } } }
                : { settings: { index: { mode: modes[index] } } },
          }
        : {}
    ),
  };
  const fieldCaps = jest.fn(async ({ fields }: { fields: string[] }) => ({
    indices: [],
    fields: Object.fromEntries(
      fields.filter((f) => mapped.includes(f)).map((f) => [f, { keyword: { type: 'keyword' } }])
    ),
  }));
  return { es: { esql, indices, fieldCaps } as unknown as ElasticsearchClient, esql };
};

const registryFor = (definitions: Array<typeof podDefinition>): EntityDefinitionRegistry =>
  ({
    getDefinition: async (type: string) => {
      const definition = definitions.find((d) => d.type === type);
      return definition ? { definition, source: 'api' } : undefined;
    },
    getDefinitions: async () => definitions.map((definition) => ({ definition, source: 'api' })),
  } as unknown as EntityDefinitionRegistry);

const POD_FIELDS = [
  'kubernetes.pod.uid',
  'kubernetes.pod.name',
  'kubernetes.namespace',
  'kubernetes.node.name',
  'k8s.pod.cpu.usage',
  'k8s.pod.memory.usage',
  'kubernetes.pod.cpu.usage.nanocores',
  'kubernetes.pod.memory.usage.bytes',
  'kubernetes.pod.status.phase',
  'k8s.pod.phase',
];

const service = (es: ElasticsearchClient, definitions = [podDefinition, hostDefinition]) =>
  new InventoryService({
    esClient: es,
    registry: registryFor(definitions),
    metadata: new SourceMetadataResolver(0),
    logger,
  });

describe('InventoryService', () => {
  const podModes = {
    'metrics-kubeletstatsreceiver.otel-default': 'time_series',
    'metrics-kubernetes.pod-*': 'time_series',
    'metrics-kubernetes.state_pod-*': 'time_series',
    'metrics-k8sclusterreceiver.otel-default': 'time_series',
  };

  it('runs one query per filtered metric and merges the plans of a source into one row', async () => {
    const queries: string[] = [];
    const respond = (query: string) => {
      queries.push(query);
      if (query.startsWith('SET unmapped_fields="nullify";\nFROM')) {
        return table([{ count: 1 }]);
      }
      const host = {
        'entity.id': 'host:node-a',
        'host.id': 'node-a',
        last_seen: '2026-09-16T08:44:00.000Z',
      };
      if (query.includes('state == "idle"')) {
        return table([{ ...host, cpu_pct: 0.25 }]);
      }
      if (query.includes('metrics-hostmetricsreceiver.otel-default')) {
        return table([{ ...host, load_1m: 1.5 }]);
      }
      return table([]);
    };
    const { es } = fakeEs(
      respond,
      {
        'metrics-hostmetricsreceiver.otel-default': 'time_series',
        'metrics-system.*': 'time_series',
      },
      ['host.id', 'system.cpu.utilization', 'system.cpu.load_average.1m']
    );
    const response = await service(es, [hostFilteredMetricsDefinition]).list('host', RANGE);

    // Three list queries (the idle plan, the unfiltered plan, the ECS source) plus the count.
    const listQueries = queries.filter((query) => !query.includes('| STATS BY '));
    expect(listQueries).toHaveLength(3);
    expect(listQueries.filter((query) => query.includes('state == "idle"'))).toHaveLength(1);
    // The filtered plan asks only for its own metric, so the presence prefilter stays narrow.
    const [idle] = listQueries.filter((query) => query.includes('state == "idle"'));
    expect(idle).toContain('AND (`system.cpu.utilization` IS NOT NULL)');
    expect(idle).not.toContain('system.cpu.load_average.1m');

    expect(response.rows).toStrictEqual([
      {
        'entity.id': 'host:node-a',
        'host.id': 'node-a',
        'host.name': null,
        'host.hostname': null,
        'host.os.name': null,
        'host.os.platform': null,
        'host.architecture': null,
        cpu_pct: 0.25,
        load_1m: 1.5,
        last_seen: '2026-09-16T08:44:00.000Z',
      },
    ]);
    // Plans of one source share its index pattern, so provenance names the pattern for both.
    expect(response.provenance['host:node-a']).toEqual({
      cpu_pct: 'metrics-hostmetricsreceiver.otel-default',
      load_1m: 'metrics-hostmetricsreceiver.otel-default',
    });
    expect(response.errors).toEqual([]);
  });

  it('rejects a source missing part of every identity composition without warning about its filter', async () => {
    const { es, esql } = fakeEs(() => table([]), podModes, ['kubernetes.namespace']);
    const response = await service(es, [deploymentDefinition]).list('k8s.deployment', {
      ...RANGE,
      documentFilter: { term: { environment: 'prod' } },
    });
    expect(response.errors).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining('no complete identity composition'),
      })
    );
    expect(response.documentFilterWarnings).toEqual([]);
    expect(esql.query).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'requires coexisting composite fields (complete: %s)',
    async (complete) => {
      const { es, esql } = fakeEs(() => table([]), podModes, []);
      jest.spyOn(es.indices, 'getSettings').mockResolvedValue({
        first: { settings: { index: { mode: 'standard' } } },
        second: { settings: { index: { mode: 'standard' } } },
      });
      jest.spyOn(es, 'fieldCaps').mockResolvedValue({
        indices: ['first', 'second'],
        fields: {
          'kubernetes.namespace': {
            keyword: {
              type: 'keyword',
              searchable: true,
              aggregatable: true,
              indices: complete ? ['first', 'second'] : ['first'],
            },
          },
          'kubernetes.deployment.name': {
            keyword: { type: 'keyword', searchable: true, aggregatable: true, indices: ['second'] },
          },
        },
      });
      const response = await service(es, [deploymentDefinition]).list('k8s.deployment', {
        ...RANGE,
        documentFilter: { term: { environment: 'prod' } },
      });
      expect(response.errors).toHaveLength(complete ? 0 : 2);
      expect(esql.query).toHaveBeenCalledTimes(complete ? 3 : 0);
      expect(response.documentFilterWarnings).toEqual(
        complete
          ? [
              expect.objectContaining({
                code: 'source_excluded',
                eligibleIndexCount: 1,
                excludedIndices: ['second'],
                sourcePatterns: expect.arrayContaining([
                  'metrics-kubeletstatsreceiver.otel-default',
                  'metrics-kubernetes.state_deployment-*',
                ]),
              }),
            ]
          : []
      );
    }
  );

  it('warns only for resolved sources and leaves source and count requests unchanged', async () => {
    const modes = { 'metrics-kubeletstatsreceiver.otel-default': 'time_series' };
    const { es, esql } = fakeEs(
      (query) => (query.includes('METADATA') ? table([{ count: 0 }]) : table([])),
      modes,
      POD_FIELDS
    );
    const inventory = service(es);
    await inventory.list('k8s.pod', RANGE);
    const originalQueries = esql.query.mock.calls.map(([request]) => request.query);
    esql.query.mockClear();
    const documentFilter = { term: { environment: 'prod' } };
    const response = await inventory.list('k8s.pod', { ...RANGE, documentFilter });
    expect(response.documentFilterWarnings).toEqual([
      expect.objectContaining({
        sourcePatterns: ['metrics-kubeletstatsreceiver.otel-default'],
        code: 'source_excluded',
        fields: ['environment'],
        columns: expect.arrayContaining(['cpu_cores', 'mem_bytes']),
      }),
    ]);
    expect(response.errors).toHaveLength(3);
    expect(esql.query.mock.calls.map(([request]) => request.query)).toEqual(originalQueries);
    for (const [request] of esql.query.mock.calls) {
      expect(request).toEqual(expect.objectContaining({ filter: documentFilter }));
    }
  });

  it('lists types with identity, columns and sources', async () => {
    const { es } = fakeEs(() => table([]), {}, []);
    const { types } = await service(es).listTypes();
    expect(types.map((t) => [t.type, t.identity.kind, t.identity.fields])).toEqual([
      ['k8s.pod', 'tuple', ['kubernetes.pod.uid']],
      ['host', 'ranking', ['host.id', 'host.name', 'host.hostname']],
    ]);
    expect(types[0].columns.map((c) => c.name)).toEqual([
      'entity.id',
      'kubernetes.pod.uid',
      'kubernetes.pod.name',
      'kubernetes.namespace',
      'kubernetes.node.name',
      'phase',
      'cpu_cores',
      'mem_bytes',
      'last_seen',
    ]);
  });

  it('merges per-source rows by entity id, labels values, sorts, counts exactly and isolates a failing source', async () => {
    const respond: Responder = (query) => {
      if (query.includes('METADATA _index')) {
        return table([{ count: 3 }], 8);
      }
      if (query.includes('TS metrics-kubeletstatsreceiver')) {
        return table(
          [
            {
              'entity.id': 'k8s.pod:a',
              'kubernetes.pod.uid': 'a',
              'kubernetes.pod.name': 'pod-a',
              cpu_cores: 0.5,
              mem_bytes: 100,
              last_seen: '2026-09-16T08:44:00.000Z',
            },
            {
              'entity.id': 'k8s.pod:b',
              'kubernetes.pod.uid': 'b',
              'kubernetes.pod.name': 'pod-b',
              cpu_cores: 0.1,
              mem_bytes: 50,
              last_seen: '2026-09-16T08:43:00.000Z',
            },
          ],
          14,
          810
        );
      }
      if (query.includes('TS metrics-kubernetes.pod-*')) {
        return new Error('shard failure');
      }
      if (query.includes('TS metrics-kubernetes.state_pod-*')) {
        return table(
          [
            {
              'entity.id': 'k8s.pod:a',
              'kubernetes.pod.uid': 'a',
              'kubernetes.pod.name': 'pod-a',
              phase: 'Running',
              last_seen: '2026-09-16T08:44:30.000Z',
            },
          ],
          3
        );
      }
      if (query.includes('TS metrics-k8sclusterreceiver')) {
        return table(
          [
            {
              'entity.id': 'k8s.pod:c',
              'kubernetes.pod.uid': 'c',
              'kubernetes.pod.name': 'pod-c',
              phase: 3,
              last_seen: '2026-09-16T08:30:00.000Z',
            },
          ],
          4
        );
      }
      throw new Error(`unexpected query ${query}`);
    };
    const { es, esql } = fakeEs(respond, podModes, POD_FIELDS);
    const response = await service(es).list('k8s.pod', {
      ...RANGE,
      limit: 10,
      sort: { column: 'cpu_cores', direction: 'desc' },
    });

    // Every row carries every output column, null where no source produced a value.
    const empty = {
      'kubernetes.namespace': null,
      'kubernetes.node.name': null,
    };
    expect(response.rows).toStrictEqual([
      {
        ...empty,
        'entity.id': 'k8s.pod:a',
        'kubernetes.pod.uid': 'a',
        'kubernetes.pod.name': 'pod-a',
        cpu_cores: 0.5,
        mem_bytes: 100,
        phase: 'running',
        last_seen: '2026-09-16T08:44:30.000Z',
      },
      {
        ...empty,
        'entity.id': 'k8s.pod:b',
        'kubernetes.pod.uid': 'b',
        'kubernetes.pod.name': 'pod-b',
        cpu_cores: 0.1,
        mem_bytes: 50,
        phase: null,
        last_seen: '2026-09-16T08:43:00.000Z',
      },
      {
        ...empty,
        'entity.id': 'k8s.pod:c',
        'kubernetes.pod.uid': 'c',
        'kubernetes.pod.name': 'pod-c',
        cpu_cores: null,
        mem_bytes: null,
        phase: 'succeeded',
        last_seen: '2026-09-16T08:30:00.000Z',
      },
    ]);
    expect(response.provenance).toEqual({
      'k8s.pod:a': {
        'kubernetes.pod.name': 'metrics-kubernetes.state_pod-*',
        cpu_cores: 'metrics-kubeletstatsreceiver.otel-default',
        mem_bytes: 'metrics-kubeletstatsreceiver.otel-default',
        phase: 'metrics-kubernetes.state_pod-*',
      },
      'k8s.pod:b': {
        'kubernetes.pod.name': 'metrics-kubeletstatsreceiver.otel-default',
        cpu_cores: 'metrics-kubeletstatsreceiver.otel-default',
        mem_bytes: 'metrics-kubeletstatsreceiver.otel-default',
      },
      'k8s.pod:c': {
        'kubernetes.pod.name': 'metrics-k8sclusterreceiver.otel-default',
        phase: 'metrics-k8sclusterreceiver.otel-default',
      },
    });
    expect(response.total).toBe(3);
    expect(response.truncated).toBe(false);
    expect(response.errors).toEqual([
      { index: 'metrics-kubernetes.pod-*', message: 'shard failure' },
    ]);
    expect(
      response.queries.map((q) => [q.index, q.engine, q.rows ?? null, q.tookMs ?? null])
    ).toEqual([
      ['metrics-kubeletstatsreceiver.otel-default', 'TS', 2, 14],
      ['metrics-kubernetes.pod-*', 'TS', null, null],
      ['metrics-kubernetes.state_pod-*', 'TS', 1, 3],
      ['metrics-k8sclusterreceiver.otel-default', 'TS', 1, 4],
      ['*', 'COUNT', null, 8],
    ]);
    expect(response.esTookMs).toBe(29);
    expect(response.unavailableColumns).toEqual([]);
    // Five queries ran concurrently: four sources plus the count.
    expect(esql.query).toHaveBeenCalledTimes(5);
    const [, [request]] = esql.query.mock.calls as unknown as Array<[{ params: unknown }]>;
    expect(request.params).toEqual([{ from: RANGE.from }, { to: RANGE.to }]);
    expect(response.columns.find((c) => c.name === 'cpu_cores')?.esType).toBe('double');
  });

  it('marks truncation from the exact count and reports capped sources', async () => {
    const many = Array.from({ length: 10_000 }, (_, i) => ({
      'entity.id': `k8s.pod:${i}`,
      'kubernetes.pod.uid': `${i}`,
      cpu_cores: i,
      last_seen: '2026-09-16T08:44:00.000Z',
    }));
    const respond: Responder = (query) =>
      query.includes('METADATA _index')
        ? table([{ count: 12_345 }])
        : query.includes('kubeletstats')
        ? table(many)
        : table([]);
    const { es } = fakeEs(respond, podModes, POD_FIELDS);
    const response = await service(es).list('k8s.pod', { ...RANGE, limit: 50 });
    expect(response.rows).toHaveLength(50);
    expect(response.total).toBe(12_345);
    expect(response.truncated).toBe(true);
    expect(response.queries[0].capped).toBe(true);
  });

  it('reports unmapped declared fields per source and excludes sources whose identity is unmapped or missing', async () => {
    const modes = { ...podModes };
    delete (modes as Record<string, string>)['metrics-k8sclusterreceiver.otel-default'];
    const { es, esql } = fakeEs(
      (query) => (query.includes('METADATA') ? table([{ count: 0 }]) : table([])),
      modes,
      ['kubernetes.pod.uid', 'k8s.pod.cpu.usage']
    );
    const response = await service(es).list('k8s.pod', RANGE);
    expect(response.errors).toEqual([
      {
        index: 'metrics-k8sclusterreceiver.otel-default',
        message: 'no index matches "metrics-k8sclusterreceiver.otel-default"',
      },
    ]);
    expect(response.unavailableColumns).toContainEqual({
      index: 'metrics-kubeletstatsreceiver.otel-default',
      column: 'mem_bytes',
      field: 'k8s.pod.memory.usage',
    });
    expect(response.unavailableColumns).toContainEqual({
      index: 'metrics-kubernetes.state_pod-*',
      column: 'phase',
      field: 'kubernetes.pod.status.phase',
    });
    // Three sources resolved plus the count.
    expect(esql.query).toHaveBeenCalledTimes(4);
  });

  it('rejects an unknown type, an unknown sort column and unknown detail identity fields', async () => {
    const { es } = fakeEs(() => table([]), podModes, POD_FIELDS);
    await expect(service(es).list('nope', RANGE)).rejects.toBeInstanceOf(
      InventoryTypeNotFoundError
    );
    await expect(
      service(es).list('k8s.pod', { ...RANGE, sort: { column: 'ghost', direction: 'asc' } })
    ).rejects.toBeInstanceOf(InventoryRequestError);
    await expect(
      service(es).detail('k8s.pod', { ...RANGE, identity: { 'kubernetes.pod.name': 'x' } })
    ).rejects.toBeInstanceOf(InventoryRequestError);
  });

  it('details by identity values and falls back to FROM for a mixed pattern', async () => {
    const { es, esql } = fakeEs(
      (query) =>
        table([
          {
            'entity.id': 'host:kind-worker',
            'host.id': null,
            'host.name': 'kind-worker',
            'host.hostname': null,
            cpu_pct: 0.1,
            __entity_inventory_bucket: '2026-09-16T08:43:00.000Z',
            last_seen: '2026-09-16T08:44:00.000Z',
          },
        ]),
      { 'metrics-hostmetricsreceiver.otel-default': 'time_series', 'metrics-system.*': 'standard' },
      ['host.name', 'system.cpu.utilization', 'system.cpu.total.norm.pct']
    );
    const response = await service(es).detail('host', {
      ...RANGE,
      identity: { 'host.name': 'kind-worker' },
    });
    expect(response.rows).toHaveLength(1);
    expect(response.rows[0].cpu_pct).toBeNull();
    expect(response.timeSeries).toEqual({
      ...RANGE,
      targetBuckets: 250,
      points: [
        {
          entityId: 'host:kind-worker',
          timestamp: '2026-09-16T08:43:00.000Z',
          metrics: { cpu_pct: 0.1, load_1m: null },
        },
      ],
    });
    expect(response.queries.map((q) => q.engine)).toEqual(['TS', 'TS', 'FROM']);
    const requests = esql.query.mock.calls.map(
      ([request]) => request as { query: string; params: unknown[] }
    );
    expect(requests[0].query).toContain('`host.name` == ?id_0');
    expect(requests[0].params).toEqual([
      { from: RANGE.from },
      { to: RANGE.to },
      { id_0: 'kind-worker' },
    ]);
    expect(requests[2].query).not.toContain('_OVER_TIME');
  });

  it('retains successful detail series and metricless attributes when another source fails', async () => {
    const { es, esql } = fakeEs(
      (query) => {
        if (query.includes('TS metrics-kubernetes.pod-*')) {
          return new Error('source unavailable');
        }
        if (query.includes('TS metrics-kubeletstatsreceiver')) {
          return table([
            {
              'entity.id': 'k8s.pod:p1',
              'kubernetes.pod.uid': 'p1',
              __entity_inventory_bucket: RANGE.from,
              cpu_cores: 1,
              mem_bytes: 123,
              last_seen: RANGE.from,
            },
          ]);
        }
        return table([
          {
            'entity.id': 'k8s.pod:p1',
            'kubernetes.pod.uid': 'p1',
            phase: 'Running',
            last_seen: RANGE.from,
          },
        ]);
      },
      podModes,
      POD_FIELDS
    );
    const response = await service(es).detail('k8s.pod', {
      ...RANGE,
      identity: { 'kubernetes.pod.uid': 'p1' },
    });
    expect(response.timeSeries.points).toEqual([
      { entityId: 'k8s.pod:p1', timestamp: RANGE.from, metrics: { cpu_cores: 1, mem_bytes: 123 } },
    ]);
    expect(response.rows[0]).toMatchObject({ phase: 'running', cpu_cores: null, mem_bytes: null });
    expect(response.errors).toEqual([expect.objectContaining({ message: 'source unavailable' })]);
    expect(esql.query).toHaveBeenCalledTimes(4);
    expect(response.queries.map(({ esql: query }) => query.includes('BUCKET('))).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(response.truncated).toBe(false);
  });

  it('flags capped detail sources and retains only series for the returned entities', async () => {
    const { es } = fakeEs(
      () =>
        table(
          Array.from({ length: 10000 }, (_, position) => ({
            'entity.id': `host:${position % 51}`,
            'host.id': String(position % 51),
            __entity_inventory_bucket: RANGE.from,
            cpu_pct: position,
            last_seen: RANGE.from,
          }))
        ),
      { 'metrics-hostmetricsreceiver.otel-default': 'time_series', 'metrics-system.*': 'standard' },
      ['host.id', 'system.cpu.utilization']
    );
    const response = await service(es).detail('host', {
      ...RANGE,
      identity: { 'host.name': 'shared' },
    });
    const returnedIds = new Set(response.rows.map((row) => row['entity.id']));
    expect(response.truncated).toBe(true);
    expect(response.rows).toHaveLength(50);
    expect(response.timeSeries.points).toHaveLength(50);
    expect(response.timeSeries.points.every(({ entityId }) => returnedIds.has(entityId))).toBe(
      true
    );
    expect(response.queries.every(({ capped }) => capped)).toBe(true);
  });

  it('counts documents in the window per distinct source pattern, isolating failures', async () => {
    const { es, esql } = fakeEs(
      (query) =>
        query.includes('FROM metrics-k8sclusterreceiver')
          ? new Error('boom')
          : table([{ count: 1234 }], 3),
      podModes,
      POD_FIELDS
    );
    const response = await service(es).documentCounts('k8s.pod', RANGE);
    expect(response.counts).toEqual([
      { index: 'metrics-kubeletstatsreceiver.otel-default', documentsInWindow: 1234, tookMs: 3 },
      { index: 'metrics-kubernetes.pod-*', documentsInWindow: 1234, tookMs: 3 },
      { index: 'metrics-kubernetes.state_pod-*', documentsInWindow: 1234, tookMs: 3 },
      { index: 'metrics-k8sclusterreceiver.otel-default', documentsInWindow: null, error: 'boom' },
    ]);
    // Four patterns, four count queries, no predicates beyond the window.
    expect(esql.query).toHaveBeenCalledTimes(4);
    const [[first]] = esql.query.mock.calls as unknown as Array<
      [{ query: string; params: unknown }]
    >;
    expect(first.query).toBe(
      'FROM metrics-kubeletstatsreceiver.otel-default\n| WHERE @timestamp >= ?from AND @timestamp < ?to\n| STATS `count` = COUNT(*)'
    );
    expect(first.params).toEqual([{ from: RANGE.from }, { to: RANGE.to }]);
  });

  it('counts with documentFilter passed as the Elasticsearch request filter', async () => {
    const { es, esql } = fakeEs(() => table([{ count: 42 }]), podModes, POD_FIELDS);
    const response = await service(es).count('k8s.pod', {
      ...RANGE,
      documentFilter: { term: { 'kubernetes.namespace': 'payments' } },
    });
    expect(response.count).toBe(42);
    expect(esql.query).toHaveBeenCalledTimes(1);
    const [[countRequest]] = esql.query.mock.calls as unknown as Array<[{ filter: unknown }]>;
    expect(countRequest.filter).toEqual({ term: { 'kubernetes.namespace': 'payments' } });
  });
});
