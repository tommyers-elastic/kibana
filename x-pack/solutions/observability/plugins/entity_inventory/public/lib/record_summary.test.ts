/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { EntityDefinitionRecord } from '@kbn/entity-store/common';
import { describeIdentity, getRecordKind, getSourceIndices } from './record_summary';

const record = (overrides: Record<string, unknown>): EntityDefinitionRecord =>
  ({
    source: 'api',
    definition: {
      id: 'registered_k8s.pod_default',
      type: 'k8s.pod',
      name: 'Pods',
      identityField: { singleField: 'kubernetes.pod.uid' },
      ...overrides,
    },
  } as unknown as EntityDefinitionRecord);

const hostRanking = {
  euidRanking: {
    branches: [
      {
        ranking: [
          [{ field: 'host.id' }],
          [{ field: 'host.name' }],
          [{ field: 'host.hostname' }],
          [{ field: 'host.name' }, { sep: ':' }, { field: 'host.id' }],
        ],
      },
    ],
  },
  documentsFilter: { and: [] },
};

describe('getRecordKind', () => {
  it('distinguishes api definitions, bare built-ins, extended built-ins and code records', () => {
    expect(getRecordKind({ ...record({}), source: 'api' })).toBe('definition');
    expect(getRecordKind({ ...record({}), source: 'code' })).toBe('code');
    expect(getRecordKind({ ...record({}), source: 'built_in' })).toBe('built_in');
    expect(getRecordKind({ ...record({}), source: 'built_in', inventorySource: 'api' })).toBe(
      'built_in_extension'
    );
    expect(getRecordKind({ ...record({}), source: 'built_in', inventorySource: 'code' })).toBe(
      'built_in_extension'
    );
  });
});

describe('describeIdentity', () => {
  it('joins an authored identity tuple with " + "', () => {
    expect(
      describeIdentity(
        record({
          inventory: {
            identity: ['kubernetes.namespace', 'kubernetes.deployment.name'],
            sources: [{ index: 'metrics-*' }],
          },
        })
      )
    ).toBe('kubernetes.namespace + kubernetes.deployment.name');
  });

  it('falls back to the single identity field', () => {
    expect(describeIdentity(record({}))).toBe('kubernetes.pod.uid');
  });

  it('lists the distinct fields of a ranking identity in order', () => {
    expect(describeIdentity(record({ identityField: hostRanking }))).toBe(
      'ranking: host.id, host.name, host.hostname'
    );
  });
});

describe('getSourceIndices', () => {
  it('returns the index patterns of the inventory sources, or none without an extension', () => {
    expect(
      getSourceIndices(
        record({
          inventory: {
            identity: ['a'],
            sources: [{ index: 'metrics-a-*' }, { index: 'metrics-b-*', filter: 'x == 1' }],
          },
        })
      )
    ).toEqual(['metrics-a-*', 'metrics-b-*']);
    expect(getSourceIndices(record({}))).toEqual([]);
  });
});
