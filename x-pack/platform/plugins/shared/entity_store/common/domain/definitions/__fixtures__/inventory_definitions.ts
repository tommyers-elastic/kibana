/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * Observability inventory definitions ported from the entity-query-benchmarking prototype
 * (`app/definitions.json`). Test fixtures only: nothing registers them yet.
 *
 * Structural fields (identity, attributes) use canonical ECS names; the ECS<->OTel alias layer
 * makes them resolve on both pipeline shapes. Metrics do not alias (units differ), so every source
 * declares its own metric variants in the pipeline's native field names. The prototype's raw ES|QL
 * metrics and captures are expressed as `{ field, agg }` and `attributes`; the query generator
 * owns the engine-specific ES|QL. Edges and derived metadata are deliberately not ported.
 */

import type { EntityDefinitionWithoutId } from '../entity_schema';
import { buildInventoryEntityDefinition } from '../inventory_definition';

const OTEL_KUBELETSTATS_INDEX = 'metrics-kubeletstatsreceiver.otel-default';
const OTEL_K8S_CLUSTER_INDEX = 'metrics-k8sclusterreceiver.otel-default';
const ECS_KUBERNETES_INDEX = 'metrics-kubernetes.tsdb-default';

export const k8sPodInventoryDefinition: EntityDefinitionWithoutId = buildInventoryEntityDefinition({
  type: 'k8s.pod',
  name: `Observability 'k8s.pod' inventory definition`,
  inventory: {
    label: 'K8s Pod',
    identity: ['kubernetes.pod.uid'],
    attributes: [
      'kubernetes.pod.name',
      'kubernetes.namespace',
      'kubernetes.node.name',
      'kubernetes.pod.status.phase',
    ],
    sources: [
      {
        index: OTEL_KUBELETSTATS_INDEX,
        metrics: [
          { name: 'cpu_cores', field: 'k8s.pod.cpu.usage', agg: 'avg' },
          { name: 'mem_bytes', field: 'k8s.pod.memory.usage', agg: 'avg' },
        ],
      },
      {
        index: ECS_KUBERNETES_INDEX,
        filter: 'metricset.name IN ("pod", "state_pod")',
        metrics: [
          { name: 'cpu_node_pct', field: 'kubernetes.pod.cpu.usage.node.pct', agg: 'avg' },
          { name: 'mem_usage_bytes', field: 'kubernetes.pod.memory.usage.bytes', agg: 'avg' },
        ],
      },
      {
        // Contributes existence and attributes only (pod phase as a numeric gauge on this pipeline).
        index: OTEL_K8S_CLUSTER_INDEX,
        filter: 'k8s.pod.phase IS NOT NULL',
      },
    ],
  },
});

export const k8sNodeInventoryDefinition: EntityDefinitionWithoutId = buildInventoryEntityDefinition(
  {
    type: 'k8s.node',
    name: `Observability 'k8s.node' inventory definition`,
    inventory: {
      label: 'K8s Node',
      identity: ['kubernetes.node.name'],
      sources: [
        {
          index: OTEL_KUBELETSTATS_INDEX,
          metrics: [
            { name: 'cpu_cores', field: 'k8s.node.cpu.usage', agg: 'avg' },
            { name: 'mem_bytes', field: 'k8s.node.memory.usage', agg: 'avg' },
          ],
        },
        {
          index: ECS_KUBERNETES_INDEX,
          filter: 'metricset.name == "node"',
          metrics: [
            { name: 'cpu_nanocores', field: 'kubernetes.node.cpu.usage.nanocores', agg: 'avg' },
            { name: 'mem_usage_bytes', field: 'kubernetes.node.memory.usage.bytes', agg: 'avg' },
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
export const k8sDeploymentInventoryDefinition: EntityDefinitionWithoutId =
  buildInventoryEntityDefinition({
    type: 'k8s.deployment',
    name: `Observability 'k8s.deployment' inventory definition`,
    inventory: {
      label: 'K8s Deployment',
      identity: ['kubernetes.namespace', 'kubernetes.deployment.name'],
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
          index: ECS_KUBERNETES_INDEX,
          filter: 'metricset.name == "state_deployment"',
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

export const k8sStatefulsetInventoryDefinition: EntityDefinitionWithoutId =
  buildInventoryEntityDefinition({
    type: 'k8s.statefulset',
    name: `Observability 'k8s.statefulset' inventory definition`,
    inventory: {
      label: 'K8s Statefulset',
      identity: ['kubernetes.namespace', 'kubernetes.statefulset.name'],
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
          index: ECS_KUBERNETES_INDEX,
          filter: 'metricset.name == "state_statefulset"',
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
