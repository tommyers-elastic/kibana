/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * Observability inventory definitions ported from the entity-query-benchmarking prototype
 * (`app/definitions.json`). Test fixtures only: nothing registers them yet. Built with the
 * `buildInventoryEntityDefinition` helper, which spells out the core `identityField` for a tuple.
 *
 * Structural fields (identity, attributes) use canonical ECS names; the ECS<->OTel alias layer
 * makes them resolve on both pipeline shapes. Metrics do not alias (units differ), so every source
 * declares its own metric variants in the pipeline's native field names. The prototype's raw ES|QL
 * metrics and captures are expressed as `{ field, agg }` and `attributes`; the query generator
 * owns the engine-specific ES|QL. Edges and derived metadata are deliberately not ported.
 */

import {
  buildInventoryEntityDefinition,
  type InventoryEntityDefinition,
} from '../inventory_definition';

const OTEL_KUBELETSTATS_INDEX = 'metrics-kubeletstatsreceiver.otel-default';
const OTEL_K8S_CLUSTER_INDEX = 'metrics-k8sclusterreceiver.otel-default';
// The Kubernetes integration writes one data stream per metricset, so each ECS source names its
// stream and needs no `metricset.name` filter.
const ECS_K8S_POD_INDEX = 'metrics-kubernetes.pod-*';
const ECS_K8S_STATE_POD_INDEX = 'metrics-kubernetes.state_pod-*';
const ECS_K8S_NODE_INDEX = 'metrics-kubernetes.node-*';
const ECS_K8S_STATE_DEPLOYMENT_INDEX = 'metrics-kubernetes.state_deployment-*';
const ECS_K8S_STATE_STATEFULSET_INDEX = 'metrics-kubernetes.state_statefulset-*';

/** OTel `k8s.pod.phase` gauge values (1..5) and ECS `kubernetes.pod.status.phase` keywords, unified. */
const OTEL_POD_PHASE_LABELS = {
  '1': 'pending',
  '2': 'running',
  '3': 'succeeded',
  '4': 'failed',
  '5': 'unknown',
};
const ECS_POD_PHASE_LABELS = {
  Pending: 'pending',
  Running: 'running',
  Succeeded: 'succeeded',
  Failed: 'failed',
  Unknown: 'unknown',
};

export const k8sPodInventoryDefinition: InventoryEntityDefinition = buildInventoryEntityDefinition({
  type: 'k8s.pod',
  name: `Observability 'k8s.pod' inventory definition`,
  identity: ['kubernetes.pod.uid'],
  inventory: {
    label: 'K8s Pod',
    attributes: ['kubernetes.pod.name', 'kubernetes.namespace', 'kubernetes.node.name'],
    sources: [
      {
        index: OTEL_KUBELETSTATS_INDEX,
        metrics: [
          { name: 'cpu_cores', field: 'k8s.pod.cpu.usage', agg: 'avg', unit: 'cores' },
          { name: 'mem_bytes', field: 'k8s.pod.memory.usage', agg: 'avg', unit: 'bytes' },
        ],
      },
      {
        // Same measurements from the ECS pipeline: same names, nanocores scaled to cores.
        index: ECS_K8S_POD_INDEX,
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
        // State family as its own metric-less source: it defines existence for pending and
        // succeeded pods and carries the phase as an ECS keyword.
        index: ECS_K8S_STATE_POD_INDEX,
        attributes: [
          {
            name: 'phase',
            field: 'kubernetes.pod.status.phase',
            valueLabels: ECS_POD_PHASE_LABELS,
          },
        ],
      },
      {
        // Existence and the phase only; the phase is a numeric gauge on this pipeline.
        index: OTEL_K8S_CLUSTER_INDEX,
        filter: 'k8s.pod.phase IS NOT NULL',
        attributes: [{ name: 'phase', field: 'k8s.pod.phase', valueLabels: OTEL_POD_PHASE_LABELS }],
      },
    ],
  },
});

export const k8sNodeInventoryDefinition: InventoryEntityDefinition = buildInventoryEntityDefinition(
  {
    type: 'k8s.node',
    name: `Observability 'k8s.node' inventory definition`,
    identity: ['kubernetes.node.name'],
    inventory: {
      label: 'K8s Node',
      sources: [
        {
          index: OTEL_KUBELETSTATS_INDEX,
          metrics: [
            { name: 'cpu_cores', field: 'k8s.node.cpu.usage', agg: 'avg', unit: 'cores' },
            { name: 'mem_bytes', field: 'k8s.node.memory.usage', agg: 'avg', unit: 'bytes' },
          ],
        },
        {
          index: ECS_K8S_NODE_INDEX,
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
  }
);

/**
 * Composite identity: deployment names are only unique within a namespace. The prototype ran on a
 * single cluster; a multi-cluster deployment would prepend the cluster name to the tuple.
 */
export const k8sDeploymentInventoryDefinition: InventoryEntityDefinition =
  buildInventoryEntityDefinition({
    type: 'k8s.deployment',
    name: `Observability 'k8s.deployment' inventory definition`,
    identity: ['kubernetes.namespace', 'kubernetes.deployment.name'],
    inventory: {
      label: 'K8s Deployment',
      sources: [
        {
          // Pod-level documents: the deployment is derived from the pods that reference it.
          index: OTEL_KUBELETSTATS_INDEX,
          metrics: [
            { name: 'pods', field: 'kubernetes.pod.name', agg: 'count_distinct' },
            { name: 'avg_pod_cpu_cores', field: 'k8s.pod.cpu.usage', agg: 'avg' },
            { name: 'nodes', field: 'kubernetes.node.name', agg: 'count_distinct' },
          ],
        },
        {
          // Deployment-level state documents reported by the kubernetes integration.
          index: ECS_K8S_STATE_DEPLOYMENT_INDEX,
          metrics: [
            {
              name: 'replicas_desired',
              field: 'kubernetes.deployment.replicas.desired',
              agg: 'max',
            },
            {
              name: 'replicas_available',
              field: 'kubernetes.deployment.replicas.available',
              agg: 'max',
            },
          ],
        },
      ],
    },
  });

export const k8sStatefulsetInventoryDefinition: InventoryEntityDefinition =
  buildInventoryEntityDefinition({
    type: 'k8s.statefulset',
    name: `Observability 'k8s.statefulset' inventory definition`,
    identity: ['kubernetes.namespace', 'kubernetes.statefulset.name'],
    inventory: {
      label: 'K8s Statefulset',
      sources: [
        {
          index: OTEL_KUBELETSTATS_INDEX,
          metrics: [
            { name: 'pods', field: 'kubernetes.pod.name', agg: 'count_distinct' },
            { name: 'avg_pod_cpu_cores', field: 'k8s.pod.cpu.usage', agg: 'avg' },
            { name: 'nodes', field: 'kubernetes.node.name', agg: 'count_distinct' },
          ],
        },
        {
          index: ECS_K8S_STATE_STATEFULSET_INDEX,
          metrics: [
            {
              name: 'replicas_desired',
              field: 'kubernetes.statefulset.replicas.desired',
              agg: 'max',
            },
            { name: 'replicas_ready', field: 'kubernetes.statefulset.replicas.ready', agg: 'max' },
          ],
        },
      ],
    },
  });

export const INVENTORY_DEFINITION_FIXTURES = [
  k8sPodInventoryDefinition,
  k8sNodeInventoryDefinition,
  k8sDeploymentInventoryDefinition,
  k8sStatefulsetInventoryDefinition,
] as const;
