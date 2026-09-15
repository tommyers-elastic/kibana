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
 * Structural fields (identity, carry) use canonical ECS names; the ECS<->OTel alias layer makes
 * them resolve on both pipeline shapes. Metrics do not alias (units differ), so every source
 * declares its own metric variants in the pipeline's native field names. Edges and derived
 * metadata from the prototype are deliberately not ported: the relationship model is a later stage.
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
    carry: ['kubernetes.pod.name', 'kubernetes.namespace', 'kubernetes.node.name'],
    inventoryWindow: '15m',
    defaultSort: { field: 'last_seen', direction: 'desc' },
    sources: [
      {
        index: OTEL_KUBELETSTATS_INDEX,
        engine: 'TS',
        metrics: [
          { name: 'cpu_cores', esql: 'AVG(LAST_OVER_TIME(k8s.pod.cpu.usage))' },
          { name: 'mem_bytes', esql: 'AVG(LAST_OVER_TIME(k8s.pod.memory.usage))' },
        ],
      },
      {
        index: ECS_KUBERNETES_INDEX,
        engine: 'TS',
        filter: 'metricset.name IN ("pod", "state_pod")',
        metrics: [
          {
            name: 'cpu_node_pct',
            esql: 'AVG(LAST_OVER_TIME(kubernetes.pod.cpu.usage.node.pct))',
          },
          {
            name: 'mem_usage_bytes',
            esql: 'AVG(LAST_OVER_TIME(kubernetes.pod.memory.usage.bytes))',
          },
        ],
        captures: [
          {
            name: 'phase',
            esql: 'LAST(kubernetes.pod.status.phase, @timestamp)',
            filter: 'metricset.name == "state_pod"',
          },
        ],
      },
      {
        index: OTEL_K8S_CLUSTER_INDEX,
        engine: 'TS',
        captures: [
          {
            name: 'phase',
            esql: 'CASE(LAST(`k8s.pod.phase`, @timestamp) == 1, "pending", LAST(`k8s.pod.phase`, @timestamp) == 2, "running", LAST(`k8s.pod.phase`, @timestamp) == 3, "succeeded", LAST(`k8s.pod.phase`, @timestamp) == 4, "failed", "unknown")',
            filter: 'k8s.pod.phase IS NOT NULL',
          },
        ],
      },
    ],
    lookups: [{ index: 'entity_meta_k8s_pod', on: ['kubernetes.pod.uid'] }],
    metadataWrite: { index: 'entity_meta_k8s_pod', keyFields: ['kubernetes.pod.uid'] },
  },
});

export const k8sNodeInventoryDefinition: EntityDefinitionWithoutId = buildInventoryEntityDefinition(
  {
    type: 'k8s.node',
    name: `Observability 'k8s.node' inventory definition`,
    inventory: {
      label: 'K8s Node',
      identity: ['kubernetes.node.name'],
      inventoryWindow: '15m',
      defaultSort: { field: 'last_seen', direction: 'desc' },
      sources: [
        {
          index: OTEL_KUBELETSTATS_INDEX,
          engine: 'TS',
          metrics: [
            { name: 'cpu_cores', esql: 'AVG(LAST_OVER_TIME(k8s.node.cpu.usage))' },
            { name: 'mem_bytes', esql: 'AVG(LAST_OVER_TIME(k8s.node.memory.usage))' },
          ],
        },
        {
          index: ECS_KUBERNETES_INDEX,
          engine: 'TS',
          filter: 'metricset.name == "node"',
          metrics: [
            {
              name: 'cpu_nanocores',
              esql: 'AVG(LAST_OVER_TIME(kubernetes.node.cpu.usage.nanocores))',
            },
            {
              name: 'mem_usage_bytes',
              esql: 'AVG(LAST_OVER_TIME(kubernetes.node.memory.usage.bytes))',
            },
          ],
        },
      ],
      lookups: [{ index: 'entity_meta_k8s_node', on: ['kubernetes.node.name'] }],
      metadataWrite: { index: 'entity_meta_k8s_node', keyFields: ['kubernetes.node.name'] },
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
      inventoryWindow: '15m',
      defaultSort: { field: 'pods', direction: 'desc' },
      sources: [
        {
          // Pod-level documents: the deployment is derived from the pods that reference it.
          index: OTEL_KUBELETSTATS_INDEX,
          engine: 'FROM',
          metrics: [
            { name: 'pods', esql: 'COUNT_DISTINCT(kubernetes.pod.name)' },
            { name: 'avg_pod_cpu_cores', esql: 'AVG(k8s.pod.cpu.usage)' },
            { name: 'nodes', esql: 'COUNT_DISTINCT(kubernetes.node.name)' },
          ],
        },
        {
          // Deployment-level state documents reported by the kubernetes integration.
          index: ECS_KUBERNETES_INDEX,
          engine: 'TS',
          filter: 'metricset.name == "state_deployment"',
          metrics: [
            {
              name: 'replicas_desired',
              esql: 'MAX(LAST_OVER_TIME(kubernetes.deployment.replicas.desired))',
            },
            {
              name: 'replicas_available',
              esql: 'MAX(LAST_OVER_TIME(kubernetes.deployment.replicas.available))',
            },
          ],
        },
      ],
      lookups: [
        {
          index: 'entity_meta_k8s_deployment',
          on: ['kubernetes.namespace', 'kubernetes.deployment.name'],
        },
      ],
      metadataWrite: {
        index: 'entity_meta_k8s_deployment',
        keyFields: ['kubernetes.namespace', 'kubernetes.deployment.name'],
      },
    },
  });

export const k8sStatefulsetInventoryDefinition: EntityDefinitionWithoutId =
  buildInventoryEntityDefinition({
    type: 'k8s.statefulset',
    name: `Observability 'k8s.statefulset' inventory definition`,
    inventory: {
      label: 'K8s Statefulset',
      identity: ['kubernetes.namespace', 'kubernetes.statefulset.name'],
      inventoryWindow: '15m',
      defaultSort: { field: 'pods', direction: 'desc' },
      sources: [
        {
          index: OTEL_KUBELETSTATS_INDEX,
          engine: 'FROM',
          metrics: [
            { name: 'pods', esql: 'COUNT_DISTINCT(kubernetes.pod.name)' },
            { name: 'avg_pod_cpu_cores', esql: 'AVG(k8s.pod.cpu.usage)' },
            { name: 'nodes', esql: 'COUNT_DISTINCT(kubernetes.node.name)' },
          ],
        },
        {
          index: ECS_KUBERNETES_INDEX,
          engine: 'TS',
          filter: 'metricset.name == "state_statefulset"',
          metrics: [
            {
              name: 'replicas_desired',
              esql: 'MAX(LAST_OVER_TIME(kubernetes.statefulset.replicas.desired))',
            },
            {
              name: 'replicas_ready',
              esql: 'MAX(LAST_OVER_TIME(kubernetes.statefulset.replicas.ready))',
            },
          ],
        },
      ],
      lookups: [
        {
          index: 'entity_meta_k8s_statefulset',
          on: ['kubernetes.namespace', 'kubernetes.statefulset.name'],
        },
      ],
      metadataWrite: {
        index: 'entity_meta_k8s_statefulset',
        keyFields: ['kubernetes.namespace', 'kubernetes.statefulset.name'],
      },
    },
  });

export const INVENTORY_DEFINITION_FIXTURES = [
  k8sPodInventoryDefinition,
  k8sNodeInventoryDefinition,
  k8sDeploymentInventoryDefinition,
  k8sStatefulsetInventoryDefinition,
] as const;
