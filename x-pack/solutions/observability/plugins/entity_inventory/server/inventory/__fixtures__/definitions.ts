/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { EntityDefinition } from '@kbn/entity-store/common';
import { buildInventoryEntityDefinition } from '@kbn/entity-store/common';

/**
 * Test fixtures mirroring `entity_inventory_definitions/*.json` at the repository root: the three
 * ported k8s types (authored tuple identities, OTel and ECS sources) and a host-like type with the
 * built-in field ranking as identity and a built-in style inventory extension.
 */

const withId = (
  definition: ReturnType<typeof buildInventoryEntityDefinition>
): EntityDefinition => ({
  ...definition,
  id: `registered_${definition.type}_default`,
});

export const podDefinition: EntityDefinition = withId(
  buildInventoryEntityDefinition({
    type: 'k8s.pod',
    name: `Observability 'k8s.pod' inventory definition`,
    inventory: {
      label: 'K8s Pod',
      identity: ['kubernetes.pod.uid'],
      attributes: ['kubernetes.pod.name', 'kubernetes.namespace', 'kubernetes.node.name'],
      sources: [
        {
          index: 'metrics-kubeletstatsreceiver.otel-default',
          metrics: [
            { name: 'cpu_cores', field: 'k8s.pod.cpu.usage', agg: 'avg', unit: 'cores' },
            { name: 'mem_bytes', field: 'k8s.pod.memory.usage', agg: 'avg', unit: 'bytes' },
          ],
        },
        {
          // Same measurements from the ECS pipeline: same names, nanocores scaled to cores.
          index: 'metrics-kubernetes.pod-*',
          metrics: [
            {
              name: 'cpu_cores',
              field: 'kubernetes.pod.cpu.usage.nanocores',
              agg: 'avg',
              scale: 1e-9,
              unit: 'cores',
            },
            {
              name: 'mem_bytes',
              field: 'kubernetes.pod.memory.usage.bytes',
              agg: 'avg',
              unit: 'bytes',
            },
          ],
        },
        {
          index: 'metrics-kubernetes.state_pod-*',
          attributes: [
            {
              name: 'phase',
              field: 'kubernetes.pod.status.phase',
              valueLabels: { Pending: 'pending', Running: 'running', Succeeded: 'succeeded' },
            },
          ],
        },
        {
          index: 'metrics-k8sclusterreceiver.otel-default',
          filter: 'k8s.pod.phase IS NOT NULL',
          attributes: [
            {
              name: 'phase',
              field: 'k8s.pod.phase',
              valueLabels: { '1': 'pending', '2': 'running', '3': 'succeeded' },
            },
          ],
        },
      ],
    },
  })
);

export const nodeDefinition: EntityDefinition = withId(
  buildInventoryEntityDefinition({
    type: 'k8s.node',
    name: `Observability 'k8s.node' inventory definition`,
    inventory: {
      label: 'K8s Node',
      identity: ['kubernetes.node.name'],
      sources: [
        {
          index: 'metrics-kubeletstatsreceiver.otel-default',
          metrics: [
            { name: 'cpu_cores', field: 'k8s.node.cpu.usage', agg: 'avg', unit: 'cores' },
            { name: 'mem_bytes', field: 'k8s.node.memory.usage', agg: 'avg', unit: 'bytes' },
          ],
        },
        {
          index: 'metrics-kubernetes.node-*',
          metrics: [
            {
              name: 'cpu_cores',
              field: 'kubernetes.node.cpu.usage.nanocores',
              agg: 'avg',
              scale: 1e-9,
              unit: 'cores',
            },
            {
              name: 'mem_bytes',
              field: 'kubernetes.node.memory.usage.bytes',
              agg: 'avg',
              unit: 'bytes',
            },
          ],
        },
      ],
    },
  })
);

export const deploymentDefinition: EntityDefinition = withId(
  buildInventoryEntityDefinition({
    type: 'k8s.deployment',
    name: `Observability 'k8s.deployment' inventory definition`,
    inventory: {
      label: 'K8s Deployment',
      identity: ['kubernetes.namespace', 'kubernetes.deployment.name'],
      sources: [
        {
          index: 'metrics-kubeletstatsreceiver.otel-default',
          metrics: [
            { name: 'pods', field: 'kubernetes.pod.name', agg: 'count_distinct' },
            { name: 'avg_pod_cpu_cores', field: 'k8s.pod.cpu.usage', agg: 'avg' },
            { name: 'nodes', field: 'kubernetes.node.name', agg: 'count_distinct' },
          ],
        },
        {
          index: 'metrics-kubernetes.state_deployment-*',
          metrics: [
            {
              name: 'replicas_desired',
              field: 'kubernetes.deployment.replicas.desired',
              agg: 'max',
            },
            {
              name: 'replicas_available',
              field: 'kubernetes.deployment.replicas.available',
              agg: 'last',
            },
          ],
        },
      ],
    },
  })
);

/** Authored ranked identity: the same claim id under two field names in two streams. */
export const claimDefinition: EntityDefinition = withId(
  buildInventoryEntityDefinition({
    type: 'claim',
    name: 'Insurance claims from traces and logs',
    inventory: {
      label: 'Claim',
      identity: ['halcyon.claim_id', 'claim_id'],
      identityMode: 'ranked',
      sources: [
        {
          index: 'traces-generic.otel-default',
          filter: 'halcyon.claim_id IS NOT NULL',
          metrics: [{ name: 'spans', field: '@timestamp', agg: 'count', unit: 'count' }],
          attributes: [{ name: 'template', field: 'halcyon.template' }],
        },
        {
          index: 'logs-generic.otel-default',
          filter: 'claim_id IS NOT NULL',
          metrics: [{ name: 'fraud_score', field: 'score', agg: 'last', unit: 'ratio' }],
          attributes: [{ name: 'risk_band', field: 'risk_band' }],
        },
      ],
    },
  })
);

/** Built-in style: field ranking identity (Security's host), inventory extension without identity. */
export const hostDefinition: EntityDefinition = {
  id: 'security_host_default',
  type: 'host',
  name: `Security 'host' Entity Store Definition`,
  identityField: {
    euidRanking: {
      branches: [
        {
          ranking: [[{ field: 'host.id' }], [{ field: 'host.name' }], [{ field: 'host.hostname' }]],
        },
      ],
    },
    documentsFilter: {
      or: [
        {
          and: [
            { field: 'host.id', exists: true },
            { field: 'host.id', neq: '' },
          ],
        },
        {
          and: [
            { field: 'host.name', exists: true },
            { field: 'host.name', neq: '' },
          ],
        },
        {
          and: [
            { field: 'host.hostname', exists: true },
            { field: 'host.hostname', neq: '' },
          ],
        },
      ],
    },
  },
  materialisation: { mode: 'none' },
  inventory: {
    label: 'Host',
    attributes: ['host.os.name', 'host.os.platform', 'host.architecture'],
    sources: [
      {
        // OTel host gauges carry a `state` dimension; filter to one state and normalise.
        index: 'metrics-hostmetricsreceiver.otel-default',
        filter: 'state == "idle"',
        metrics: [
          {
            name: 'cpu_pct',
            field: 'system.cpu.utilization',
            agg: 'avg',
            scale: -1,
            offset: 1,
            unit: 'ratio',
          },
        ],
      },
      {
        index: 'metrics-hostmetricsreceiver.otel-default',
        metrics: [
          { name: 'load_1m', field: 'system.cpu.load_average.1m', agg: 'avg', unit: 'load' },
        ],
      },
      {
        index: 'metrics-system.*',
        filter: 'metricset.name IN ("cpu", "load")',
        metrics: [
          { name: 'cpu_pct', field: 'system.cpu.total.norm.pct', agg: 'avg', unit: 'ratio' },
          { name: 'load_1m', field: 'system.load.1', agg: 'avg', unit: 'load' },
        ],
      },
    ],
  },
};

export const ALL_FIXTURES = [
  podDefinition,
  nodeDefinition,
  deploymentDefinition,
  hostDefinition,
  claimDefinition,
];

export const RANGE = { from: '2026-09-16T08:30:00.000Z', to: '2026-09-16T08:45:00.000Z' };
