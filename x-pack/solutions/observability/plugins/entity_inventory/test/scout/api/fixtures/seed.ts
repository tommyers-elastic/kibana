/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Client } from '@elastic/elasticsearch';
import type { IndicesIndexSettings, MappingProperty } from '@elastic/elasticsearch/lib/api/types';

/**
 * A small, deterministic pod corpus in the OTel document shape: one TSDB index with pod metrics,
 * one TSDB index with the pod state family (phase as a numeric gauge), and a standard (non-TSDB)
 * copy of the metrics for the `FROM` fallback. Every expectation in the spec derives from the
 * seeds below (docs/08 finding 10: known seeds, expected counts).
 */

export const ANCHOR = '2026-01-15T12:00:00.000Z';
const anchorMs = Date.parse(ANCHOR);
const minutesBefore = (minutes: number) => new Date(anchorMs - minutes * 60_000).toISOString();

export const WINDOW_15M = { from: minutesBefore(15), to: ANCHOR };
export const WINDOW_6H = { from: minutesBefore(6 * 60), to: ANCHOR };

export const METRICS_INDEX = 'invtest-kubelet';
export const STATE_INDEX = 'invtest-state';
export const STANDARD_INDEX = 'invtest-standard';
export const MISSING_INDEX = 'invtest-missing';
export const ALL_INDICES = [METRICS_INDEX, STATE_INDEX, STANDARD_INDEX];

export interface SeedPod {
  uid: string;
  name: string;
  namespace: string;
  node: string;
  cpu: number;
  mem: number;
  /** Minutes before the anchor of the metric documents (one per minute). */
  metricMinutes: number[];
  /** Phase gauge value and minute of the single state document, if any. */
  state?: { phase: number; minute: number };
}

const live = (i: number, namespace: string, node: string, phase?: number): SeedPod => ({
  uid: `pod-uid-${i}`,
  name: `pod-${i}`,
  namespace,
  node,
  cpu: i / 10,
  mem: i * 100,
  metricMinutes: Array.from({ length: 14 }, (_, k) => k + 1),
  ...(phase !== undefined ? { state: { phase, minute: 2 } } : {}),
});

export const SEED_PODS: SeedPod[] = [
  live(1, 'payments', 'node-a', 2),
  live(2, 'payments', 'node-a', 2),
  live(3, 'payments', 'node-b', 2),
  live(4, 'search', 'node-b', 2),
  live(5, 'search', 'node-b'),
  // Stale: reported three hours ago only. In the 6 h window, not in the 15 m one.
  {
    uid: 'pod-uid-6',
    name: 'pod-6',
    namespace: 'search',
    node: 'node-b',
    cpu: 0.6,
    mem: 600,
    metricMinutes: [180, 181, 182],
  },
  // Phase only: never reported metrics (succeeded batch pod); exists through the state source.
  {
    uid: 'pod-uid-7',
    name: 'pod-7',
    namespace: 'search',
    node: 'node-b',
    cpu: 0,
    mem: 0,
    metricMinutes: [],
    state: { phase: 3, minute: 5 },
  },
];

/** Live in the 15 m window: metric reporters 1-5 plus the phase-only pod 7. */
export const EXPECTED_LIVE_15M = [
  'pod-uid-1',
  'pod-uid-2',
  'pod-uid-3',
  'pod-uid-4',
  'pod-uid-5',
  'pod-uid-7',
];
/** Groups by (namespace, node) among metric reporters in the 15 m window. */
export const EXPECTED_GROUPS_15M = [
  { namespace: 'payments', node: 'node-a', pods: 2 },
  { namespace: 'payments', node: 'node-b', pods: 1 },
  { namespace: 'search', node: 'node-b', pods: 2 },
];

const dimensions: Record<string, MappingProperty> = {
  'kubernetes.pod.uid': { type: 'keyword', time_series_dimension: true },
  'kubernetes.pod.name': { type: 'keyword', time_series_dimension: true },
  'kubernetes.namespace': { type: 'keyword', time_series_dimension: true },
  'kubernetes.node.name': { type: 'keyword', time_series_dimension: true },
};

const tsdbSettings: IndicesIndexSettings = {
  index: {
    mode: 'time_series',
    routing_path: ['kubernetes.pod.uid'],
    time_series: { start_time: '2026-01-01T00:00:00Z', end_time: '2026-02-01T00:00:00Z' },
    number_of_shards: 1,
  },
};

const resource = (pod: SeedPod) => ({
  'kubernetes.pod.uid': pod.uid,
  'kubernetes.pod.name': pod.name,
  'kubernetes.namespace': pod.namespace,
  'kubernetes.node.name': pod.node,
});

export async function createInventoryTestIndices(esClient: Client): Promise<void> {
  await deleteInventoryTestIndices(esClient);
  await esClient.indices.create({
    index: METRICS_INDEX,
    settings: tsdbSettings,
    mappings: {
      properties: {
        '@timestamp': { type: 'date' },
        ...dimensions,
        'k8s.pod.cpu.usage': { type: 'double', time_series_metric: 'gauge' },
        'k8s.pod.memory.usage': { type: 'long', time_series_metric: 'gauge' },
      },
    },
  });
  await esClient.indices.create({
    index: STATE_INDEX,
    settings: tsdbSettings,
    mappings: {
      properties: {
        '@timestamp': { type: 'date' },
        ...dimensions,
        'k8s.pod.phase': { type: 'long', time_series_metric: 'gauge' },
      },
    },
  });
  const standardFields: Record<string, MappingProperty> = {
    '@timestamp': { type: 'date' },
    'kubernetes.pod.uid': { type: 'keyword' },
    'kubernetes.pod.name': { type: 'keyword' },
    'kubernetes.namespace': { type: 'keyword' },
    'kubernetes.node.name': { type: 'keyword' },
    'k8s.pod.cpu.usage': { type: 'double' },
    'k8s.pod.memory.usage': { type: 'long' },
    'k8s.pod.memory_kb': { type: 'double' },
  };
  await esClient.indices.create({
    index: STANDARD_INDEX,
    mappings: { properties: standardFields },
  });

  const operations: unknown[] = [];
  for (const pod of SEED_PODS) {
    for (const minute of pod.metricMinutes) {
      const doc = {
        '@timestamp': minutesBefore(minute),
        ...resource(pod),
        'k8s.pod.cpu.usage': pod.cpu,
        'k8s.pod.memory.usage': pod.mem,
      };
      operations.push({ index: { _index: METRICS_INDEX } }, doc);
      operations.push(
        { index: { _index: STANDARD_INDEX } },
        { ...doc, 'k8s.pod.memory_kb': pod.mem / 1024 }
      );
    }
    if (pod.state) {
      operations.push(
        { index: { _index: STATE_INDEX } },
        {
          '@timestamp': minutesBefore(pod.state.minute),
          ...resource(pod),
          'k8s.pod.phase': pod.state.phase,
        }
      );
    }
  }
  const response = await esClient.bulk({ operations, refresh: true });
  if (response.errors) {
    const first = response.items.find((item) => item.index?.error);
    throw new Error(`seeding failed: ${JSON.stringify(first?.index?.error)}`);
  }
}

export async function deleteInventoryTestIndices(esClient: Client): Promise<void> {
  await esClient.indices.delete({ index: ALL_INDICES, ignore_unavailable: true });
}

const POD_ATTRIBUTES = ['kubernetes.pod.name', 'kubernetes.namespace', 'kubernetes.node.name'];
const POD_METRICS = [
  { name: 'cpu_cores', field: 'k8s.pod.cpu.usage', agg: 'avg', unit: 'cores' },
  { name: 'mem_bytes', field: 'k8s.pod.memory.usage', agg: 'avg', unit: 'bytes' },
];

/**
 * Multi-source pod type: TSDB metrics, the same metrics again from the standard copy (declared
 * second, with memory stored in kilobytes and scaled back, so precedence and scale are both
 * observable), a state family with labelled phase, an unmapped metric and a missing index.
 */
export const POD_DEFINITION = {
  type: 'invtest.pod',
  name: 'Inventory test pod',
  identityField: { singleField: 'kubernetes.pod.uid' },
  materialisation: { mode: 'none' },
  inventory: {
    label: 'Test pod',
    identity: ['kubernetes.pod.uid'],
    attributes: POD_ATTRIBUTES,
    sources: [
      {
        index: METRICS_INDEX,
        metrics: [...POD_METRICS, { name: 'ghost', field: 'k8s.pod.ghost.metric', agg: 'max' }],
      },
      {
        index: STANDARD_INDEX,
        metrics: [
          { name: 'cpu_cores', field: 'k8s.pod.cpu.usage', agg: 'avg', unit: 'cores' },
          {
            name: 'mem_bytes',
            field: 'k8s.pod.memory_kb',
            agg: 'avg',
            scale: 1024,
            unit: 'bytes',
          },
        ],
      },
      {
        index: STATE_INDEX,
        attributes: [
          {
            name: 'phase',
            field: 'k8s.pod.phase',
            valueLabels: { '2': 'running', '3': 'succeeded' },
          },
        ],
      },
      { index: MISSING_INDEX },
    ],
  },
};

/** Single TSDB source: sort and limit push down. */
export const POD_SINGLE_DEFINITION = {
  type: 'invtest.pod_single',
  name: 'Inventory test pod (single source)',
  identityField: { singleField: 'kubernetes.pod.uid' },
  materialisation: { mode: 'none' },
  inventory: {
    identity: ['kubernetes.pod.uid'],
    attributes: POD_ATTRIBUTES,
    sources: [{ index: METRICS_INDEX, metrics: POD_METRICS }],
  },
};

/** Single standard (non-TSDB) source: the `FROM` fallback. */
export const POD_STANDARD_DEFINITION = {
  type: 'invtest.pod_standard',
  name: 'Inventory test pod (standard index)',
  identityField: { singleField: 'kubernetes.pod.uid' },
  materialisation: { mode: 'none' },
  inventory: {
    identity: ['kubernetes.pod.uid'],
    attributes: POD_ATTRIBUTES,
    sources: [{ index: STANDARD_INDEX, metrics: POD_METRICS }],
  },
};

/** Composite identity (namespace, node) with a distinct count, as the deployment fixture does. */
export const GROUP_DEFINITION = {
  type: 'invtest.group',
  name: 'Inventory test group',
  identityField: {
    euidRanking: {
      branches: [
        {
          ranking: [
            [{ field: 'kubernetes.namespace' }, { sep: '/' }, { field: 'kubernetes.node.name' }],
          ],
        },
      ],
    },
    documentsFilter: {
      and: [
        {
          and: [
            { field: 'kubernetes.namespace', exists: true },
            { field: 'kubernetes.namespace', neq: '' },
          ],
        },
        {
          and: [
            { field: 'kubernetes.node.name', exists: true },
            { field: 'kubernetes.node.name', neq: '' },
          ],
        },
      ],
    },
  },
  materialisation: { mode: 'none' },
  inventory: {
    identity: ['kubernetes.namespace', 'kubernetes.node.name'],
    sources: [
      {
        index: METRICS_INDEX,
        metrics: [
          { name: 'pods', field: 'kubernetes.pod.uid', agg: 'count_distinct' },
          { name: 'avg_cpu', field: 'k8s.pod.cpu.usage', agg: 'avg' },
        ],
      },
    ],
  },
};

export const ALL_DEFINITIONS = [
  POD_DEFINITION,
  POD_SINGLE_DEFINITION,
  POD_STANDARD_DEFINITION,
  GROUP_DEFINITION,
];
