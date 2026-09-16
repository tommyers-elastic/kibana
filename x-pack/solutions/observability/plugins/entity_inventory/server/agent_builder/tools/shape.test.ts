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
import { hostDefinition, podDefinition } from '../../inventory/__fixtures__/definitions';
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
  it('returns the authored tuple', () => {
    expect(describeIdentity(podDefinition)).toEqual({
      kind: 'tuple',
      fields: ['kubernetes.pod.uid'],
    });
  });

  it('returns the ranking fields of a built-in style identity', () => {
    const identity = describeIdentity(hostDefinition);
    expect(identity.kind).toBe('ranking');
    expect(identity.fields).toEqual(expect.arrayContaining(['host.name']));
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
      identity: { kind: 'tuple', fields: ['kubernetes.pod.uid'] },
      attributes: ['kubernetes.pod.name', 'kubernetes.namespace', 'kubernetes.node.name'],
    });
    expect(summary.inventorySource).toBeUndefined();
    expect(summary.sources.map(({ index }) => index)).toEqual(
      podDefinition.inventory!.sources.map(({ index }) => index)
    );
    expect(summary.metrics).toEqual(expect.arrayContaining(['cpu_cores', 'mem_bytes']));
    expect(new Set(summary.metrics).size).toBe(summary.metrics.length);
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
    expect(
      summarizeEntityType({ definition: hostDefinition, source: 'built_in' }).editable
    ).toBe('read_only');
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
      toDefinitionDocument({ definition: hostDefinition, source: 'built_in', inventorySource: 'code' })
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

    expect(formatIssues([{ code: 'custom', path: [], message: 'nope', input: undefined }])).toEqual([
      { path: '<root>', message: 'nope' },
    ]);
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
      inventory: {
        label: 'K8s Pod',
        identity: ['kubernetes.pod.uid'],
        attributes: ['kubernetes.pod.name'],
        sources: [
          {
            index: 'metrics-kubernetes.pod-*',
            filter: 'metricset.name == "pod"',
            metrics: [{ name: 'cpu_cores', field: 'kubernetes.pod.cpu.usage.nanocores', agg: 'avg' }],
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
    expect(describeDefinitionError(new EntityDefinitionNotFoundError('t', 'default'))).toMatchObject(
      { kind: 'not_found', hint: expect.stringContaining('replace: false') }
    );
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
      esTookMs: 9,
    });
  });
});
