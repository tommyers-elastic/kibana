/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { EntityDefinitionRecord } from '@kbn/entity-store/common';
import {
  getDocumentType,
  getEditability,
  getTemplate,
  parseDocument,
  countSources,
} from './editable_document';

const apiRecord = {
  source: 'api',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  definition: {
    id: 'registered_k8s.pod_default',
    type: 'k8s.pod',
    name: 'Pods',
    identityField: { singleField: 'kubernetes.pod.uid' },
    materialisation: { mode: 'none' },
    inventory: {
      label: 'K8s Pod',
      identity: ['kubernetes.pod.uid'],
      sources: [{ index: 'metrics-kubernetes.pod-*' }, { index: 'metrics-k8s.otel-*' }],
    },
  },
} as unknown as EntityDefinitionRecord;

const hostInventory = { label: 'Host', sources: [{ index: 'metrics-system.*' }] };

const builtInRecord = (inventorySource?: 'api' | 'code'): EntityDefinitionRecord =>
  ({
    source: 'built_in',
    inventorySource,
    definition: {
      id: 'security_host_default',
      type: 'host',
      name: 'Host',
      identityField: { euidRanking: { branches: [] } },
      materialisation: { mode: 'extraction' },
      ...(inventorySource ? { inventory: hostInventory } : {}),
    },
  } as unknown as EntityDefinitionRecord);

describe('getEditability', () => {
  it('returns an api definition without its runtime id, as PUT accepts it', () => {
    const result = getEditability(apiRecord);
    expect(result.kind).toBe('definition');
    expect(result.document).not.toHaveProperty('id');
    expect(result.document).toMatchObject({ type: 'k8s.pod', name: 'Pods' });
  });

  it('returns the extension document for a built-in with an api extension', () => {
    expect(getEditability(builtInRecord('api'))).toEqual({
      kind: 'extension',
      document: { extends: 'host', inventory: hostInventory },
    });
  });

  it('marks built-ins without an extension, code extensions and code definitions read-only', () => {
    expect(getEditability(builtInRecord())).toMatchObject({
      kind: 'read_only',
      reason: 'built_in_without_extension',
    });
    expect(getEditability(builtInRecord('code'))).toMatchObject({
      kind: 'read_only',
      reason: 'built_in_code_extension',
    });
    expect(getEditability({ ...apiRecord, source: 'code' })).toMatchObject({
      kind: 'read_only',
      reason: 'code',
    });
  });
});

describe('countSources', () => {
  it('counts inventory sources and treats a missing extension as zero', () => {
    expect(countSources(apiRecord)).toBe(2);
    expect(countSources(builtInRecord())).toBe(0);
  });
});

describe('parseDocument', () => {
  it('accepts a JSON object and rejects other values with a message', () => {
    expect(parseDocument('{"type":"a"}')).toEqual({ document: { type: 'a' } });
    expect(parseDocument('[1]')).toEqual({ error: 'The document must be a JSON object' });
    expect(parseDocument('{')).toHaveProperty('error');
  });
});

describe('getDocumentType', () => {
  it('reads type for definitions and extends for extensions', () => {
    expect(getDocumentType({ type: 'k8s.pod' })).toBe('k8s.pod');
    expect(getDocumentType({ extends: 'host', inventory: {} })).toBe('host');
    expect(getDocumentType({ name: 'x' })).toBeUndefined();
  });
});

describe('getTemplate', () => {
  it('produces a definition template and an extension template aimed at a built-in', () => {
    expect(getTemplate('definition')).toMatchObject({
      type: expect.any(String),
      identityField: { singleField: expect.any(String) },
      materialisation: { mode: 'none' },
      inventory: { identity: expect.any(Array), sources: expect.any(Array) },
    });
    expect(getTemplate('extension')).toMatchObject({ extends: 'host' });
    expect(getTemplate('extension', 'user')).toMatchObject({ extends: 'user' });
  });
});
