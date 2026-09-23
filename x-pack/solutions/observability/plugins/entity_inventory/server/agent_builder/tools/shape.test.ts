/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { forbidden } from '@hapi/boom';
import type { EntityDefinitionRecord } from '@kbn/entity-store/common';
import {
  DynamicDefinitionsDisabledError,
  EntityDefinitionAlreadyExistsError,
  EntityDefinitionIdentityChangedError,
  EntityDefinitionNotFoundError,
  EntityDefinitionValidationError,
  entityDefinitionsApiBodySchema,
} from '@kbn/entity-store/server';
import type { InventoryListResponse } from '../../../common';
import {
  claimDefinition,
  deploymentDefinition,
  hostDefinition,
  hostFilteredMetricsDefinition,
  podDefinition,
} from '../../inventory/__fixtures__/definitions';
import {
  describeDefinitionError,
  describeIdentity,
  formatIssues,
  getDocumentType,
  shapePreview,
  summarizeDocument,
  summarizeEntityType,
  toDefinitionDocument,
} from './shape';

const apiPod: EntityDefinitionRecord = {
  definition: podDefinition,
  source: 'api',
  createdAt: '2026-09-16T10:00:00.000Z',
  updatedAt: '2026-09-16T11:00:00.000Z',
};

const builtInHostWithApiExtension: EntityDefinitionRecord = {
  definition: hostDefinition,
  source: 'built_in',
  inventorySource: 'api',
};

describe('describeIdentity', () => {
  it('reads a single field and a composite tuple from identityField', () => {
    expect(describeIdentity(podDefinition)).toEqual({
      kind: 'tuple',
      fields: ['kubernetes.pod.uid'],
      compositions: [['kubernetes.pod.uid']],
    });
    expect(describeIdentity(deploymentDefinition)).toEqual({
      kind: 'tuple',
      fields: ['kubernetes.namespace', 'kubernetes.deployment.name'],
      compositions: [['kubernetes.namespace', 'kubernetes.deployment.name']],
    });
  });

  it('reads ranked alternatives, built-in and authored alike', () => {
    expect(describeIdentity(hostDefinition)).toEqual({
      kind: 'ranking',
      fields: ['host.id', 'host.name', 'host.hostname'],
      compositions: [['host.id'], ['host.name'], ['host.hostname']],
    });
    expect(describeIdentity(claimDefinition)).toEqual({
      kind: 'ranking',
      fields: ['halcyon.claim_id', 'claim_id'],
      compositions: [['halcyon.claim_id'], ['claim_id']],
    });
  });
});

describe('summarizeEntityType', () => {
  it('lists identity, sources, metric and attribute names of an API definition', () => {
    const summary = summarizeEntityType(apiPod);

    expect(summary).toMatchObject({
      type: 'k8s.pod',
      label: 'K8s Pod',
      source: 'api',
      editable: 'definition',
      identity: {
        kind: 'tuple',
        fields: ['kubernetes.pod.uid'],
        compositions: [['kubernetes.pod.uid']],
      },
      attributes: ['kubernetes.pod.name', 'kubernetes.namespace', 'kubernetes.node.name'],
    });
    expect(summary.inventorySource).toBeUndefined();
    expect(summary.sources.map(({ index }) => index)).toEqual(
      podDefinition.inventory!.sources.map(({ index }) => index)
    );
    expect(summary.metrics).toEqual(expect.arrayContaining(['cpu_cores', 'mem_bytes']));
    expect(new Set(summary.metrics).size).toBe(summary.metrics.length);
    expect(summary.sources.every(({ metricFilters }) => metricFilters === undefined)).toBe(true);
  });

  it('surfaces the filter of each filtered metric on its source', () => {
    const summary = summarizeEntityType({
      definition: hostFilteredMetricsDefinition,
      source: 'api',
    });
    expect(summary.sources[0]).toEqual({
      index: 'metrics-hostmetricsreceiver.otel-default',
      metrics: ['cpu_pct', 'load_1m', 'net_rx_bps', 'net_tx_bps'],
      metricFilters: {
        cpu_pct: 'state == "idle"',
        net_rx_bps: 'direction == "receive"',
        net_tx_bps: 'direction == "transmit"',
      },
      attributes: [],
    });
    expect(summary.sources[1].metricFilters).toBeUndefined();
  });

  it('marks a built-in with an API extension as editable through an extension document', () => {
    expect(summarizeEntityType(builtInHostWithApiExtension)).toMatchObject({
      source: 'built_in',
      inventorySource: 'api',
      editable: 'extension',
    });
  });

  it('marks code definitions and bare built-ins as read-only', () => {
    expect(summarizeEntityType({ definition: podDefinition, source: 'code' }).editable).toBe(
      'read_only'
    );
    expect(summarizeEntityType({ definition: hostDefinition, source: 'built_in' }).editable).toBe(
      'read_only'
    );
  });
});

describe('toDefinitionDocument', () => {
  it('returns an API definition without its id, with the record metadata', () => {
    const result = toDefinitionDocument(apiPod);

    expect(result).toMatchObject({
      type: 'k8s.pod',
      kind: 'definition',
      source: 'api',
      createdAt: apiPod.createdAt,
      updatedAt: apiPod.updatedAt,
    });
    expect(result.readOnlyReason).toBeUndefined();
    expect(result.document).not.toHaveProperty('id');
    expect(result.document.type).toBe('k8s.pod');
    // What comes out is what the definitions API accepts back.
    expect(entityDefinitionsApiBodySchema.safeParse(result.document).success).toBe(true);
  });

  it('returns a built-in with an API extension as an extends document', () => {
    const result = toDefinitionDocument(builtInHostWithApiExtension);

    expect(result.kind).toBe('extension');
    expect(result.document).toEqual({
      extends: hostDefinition.type,
      inventory: hostDefinition.inventory,
    });
  });

  it('explains why a record is read-only', () => {
    expect(toDefinitionDocument({ definition: podDefinition, source: 'code' })).toMatchObject({
      kind: 'read_only',
      readOnlyReason: 'code',
    });
    expect(
      toDefinitionDocument({
        definition: hostDefinition,
        source: 'built_in',
        inventorySource: 'code',
      })
    ).toMatchObject({ kind: 'read_only', readOnlyReason: 'built_in_code_extension' });
    expect(toDefinitionDocument({ definition: hostDefinition, source: 'built_in' })).toMatchObject({
      kind: 'read_only',
      readOnlyReason: 'built_in_without_extension',
    });
  });
});

describe('getDocumentType', () => {
  it('reads type from a definition and extends from an extension', () => {
    expect(getDocumentType({ type: 'k8s.pod' })).toBe('k8s.pod');
    expect(getDocumentType({ extends: 'host', type: 'ignored' })).toBe('host');
    expect(getDocumentType({ name: 'x' })).toBeUndefined();
    expect(getDocumentType({ type: '' })).toBeUndefined();
  });
});

describe('formatIssues', () => {
  it('joins paths and keeps messages, naming the root', () => {
    const result = entityDefinitionsApiBodySchema.safeParse({ type: 'k8s.pod' });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    const issues = formatIssues(result.error.issues);
    expect(issues.length).toBeGreaterThan(0);
    for (const { path, message } of issues) {
      expect(path).toEqual(expect.any(String));
      expect(message.length).toBeGreaterThan(0);
    }

    expect(formatIssues([{ code: 'custom', path: [], message: 'nope', input: undefined }])).toEqual(
      [{ path: '<root>', message: 'nope' }]
    );
    expect(
      formatIssues([
        { code: 'custom', path: ['inventory', 'sources', 0, 'index'], message: 'bad', input: 1 },
      ])
    ).toEqual([{ path: 'inventory.sources.0.index', message: 'bad' }]);
  });
});

describe('summarizeDocument', () => {
  it('summarises a definition with identity, attributes and every source', () => {
    const summary = summarizeDocument({
      type: 'k8s.pod',
      identityField: { singleField: 'kubernetes.pod.uid' },
      inventory: {
        label: 'K8s Pod',
        attributes: ['kubernetes.pod.name'],
        sources: [
          {
            index: 'metrics-kubernetes.pod-*',
            filter: 'metricset.name == "pod"',
            metrics: [
              { name: 'cpu_cores', field: 'kubernetes.pod.cpu.usage.nanocores', agg: 'avg' },
            ],
            attributes: [{ name: 'phase', field: 'kubernetes.pod.status.phase' }],
          },
          { index: 'metrics-kubernetes.state_pod-*' },
        ],
      },
    });

    expect(summary).toBe(
      [
        '**Definition** of the type `k8s.pod`',
        'Label: K8s Pod',
        'Identity: `kubernetes.pod.uid`',
        'Attributes: `kubernetes.pod.name`',
        'Sources (2):',
        '- `metrics-kubernetes.pod-*` where `metricset.name == "pod"`; metrics: cpu_cores (avg of kubernetes.pod.cpu.usage.nanocores); attributes: phase',
        '- `metrics-kubernetes.state_pod-*`; no metrics',
      ].join('\n')
    );
  });

  it('shows a metric filter next to the metric it qualifies', () => {
    const summary = summarizeDocument({
      extends: 'host',
      inventory: {
        sources: [
          {
            index: 'metrics-hostmetricsreceiver.otel-default',
            metrics: [
              {
                name: 'cpu_busy_pct',
                field: 'system.cpu.utilization',
                agg: 'avg',
                filter: 'state == "idle"',
                scale: -1,
                offset: 1,
              },
              { name: 'load_1m', field: 'system.cpu.load_average.1m', agg: 'avg' },
            ],
          },
        ],
      },
    });
    expect(summary).toBe(
      [
        '**Extension** of the built-in type `host`',
        'Sources (1):',
        '- `metrics-hostmetricsreceiver.otel-default`; metrics: cpu_busy_pct (avg of system.cpu.utilization where `state == "idle"`), load_1m (avg of system.cpu.load_average.1m)',
      ].join('\n')
    );
  });

  it('summarises an extension and tolerates malformed documents', () => {
    expect(summarizeDocument({ extends: 'host', inventory: { sources: 'nope' } })).toBe(
      ['**Extension** of the built-in type `host`', 'Sources (0):'].join('\n')
    );
    expect(summarizeDocument({})).toBe(
      ['**Definition** of the type `(missing type)`', 'Sources (0):'].join('\n')
    );
    expect(summarizeDocument({ type: 't', inventory: { sources: [null, { metrics: 3 }] } })).toBe(
      [
        '**Definition** of the type `t`',
        'Sources (2):',
        '- (invalid source)',
        '- `(missing index)`; no metrics',
      ].join('\n')
    );
  });
});

describe('describeDefinitionError', () => {
  it('maps store errors to kinds with a next step', () => {
    expect(describeDefinitionError(new DynamicDefinitionsDisabledError())).toMatchObject({
      kind: 'disabled',
      hint: expect.stringContaining('entityStore:dynamicDefinitionsEnabled'),
    });
    expect(describeDefinitionError(new EntityDefinitionValidationError('bad'))).toMatchObject({
      kind: 'validation',
      message: 'bad',
    });
    expect(
      describeDefinitionError(new EntityDefinitionNotFoundError('t', 'default'))
    ).toMatchObject({ kind: 'not_found', hint: expect.stringContaining('replace: false') });
    expect(
      describeDefinitionError(new EntityDefinitionAlreadyExistsError('t', 'default'))
    ).toMatchObject({ kind: 'conflict', hint: expect.stringContaining('replace: true') });
    expect(describeDefinitionError(new EntityDefinitionIdentityChangedError('t'))).toMatchObject({
      kind: 'conflict',
      hint: expect.stringContaining('force: true'),
    });
  });

  it('maps a Boom forbidden (inventory disabled) and unknown errors', () => {
    expect(describeDefinitionError(forbidden('inventory off'))).toEqual({
      kind: 'forbidden',
      message: 'inventory off',
    });
    expect(describeDefinitionError(new Error('boom'))).toEqual({
      kind: 'unexpected',
      message: 'boom',
    });
    expect(describeDefinitionError('text')).toEqual({ kind: 'unexpected', message: 'text' });
  });
});

describe('shapePreview', () => {
  it('keeps what the agent reads and drops parameters and wall-clock timings', () => {
    const response: InventoryListResponse = {
      type: 'k8s.pod',
      columns: [
        { name: 'entity.id', kind: 'entity_id' },
        { name: 'cpu_cores', kind: 'metric', unit: 'cores', esType: 'double', fields: ['a', 'b'] },
      ],
      rows: [{ 'entity.id': 'k8s.pod:1', cpu_cores: 0.5 }],
      provenance: { 'k8s.pod:1': { cpu_cores: 'metrics-*' } },
      total: 12,
      truncated: true,
      tookMs: 40,
      esTookMs: 9,
      queries: [
        {
          index: 'metrics-*',
          engine: 'TS',
          esql: 'TS metrics-*',
          params: { from: 'x' },
          tookMs: 5,
          documentsFound: 100,
          rows: 1,
          capped: false,
        },
        { index: '*', engine: 'COUNT', esql: 'FROM *', params: {}, tookMs: 4 },
      ],
      unavailableColumns: [{ index: 'metrics-*', column: 'phase', field: 'phase' }],
      unsupportedMetrics: [
        {
          index: 'metrics-*',
          engine: 'FROM',
          column: 'net_rx_bps',
          field: 'system.network.in.bytes',
          agg: 'sum_rate',
        },
      ],
      errors: [{ index: 'logs-*', message: 'no such index' }],
    };

    expect(shapePreview(response, { from: 'f', to: 't' })).toEqual({
      type: 'k8s.pod',
      window: { from: 'f', to: 't' },
      total: 12,
      truncated: true,
      returnedRows: 1,
      columns: [
        { name: 'entity.id', kind: 'entity_id' },
        { name: 'cpu_cores', kind: 'metric', unit: 'cores', esType: 'double', fields: ['a', 'b'] },
      ],
      rows: response.rows,
      provenance: response.provenance,
      queries: [
        {
          index: 'metrics-*',
          engine: 'TS',
          tookMs: 5,
          documentsFound: 100,
          rows: 1,
          esql: 'TS metrics-*',
        },
        { index: '*', engine: 'COUNT', tookMs: 4, esql: 'FROM *' },
      ],
      errors: response.errors,
      unavailableColumns: response.unavailableColumns,
      unsupportedMetrics: response.unsupportedMetrics,
      esTookMs: 9,
    });
  });
});
