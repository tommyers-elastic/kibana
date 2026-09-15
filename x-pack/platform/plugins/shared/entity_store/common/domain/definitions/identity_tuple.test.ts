/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { isNotEmptyCondition } from './common_fields';
import { identityFieldSchema } from './entity_schema';
import { IDENTITY_TUPLE_SEPARATOR, identityTupleToIdentityField } from './identity_tuple';

describe('identityTupleToIdentityField', () => {
  it('normalises a single field to the single-field identity fast path', () => {
    expect(identityTupleToIdentityField(['kubernetes.pod.uid'])).toEqual({
      singleField: 'kubernetes.pod.uid',
    });
  });

  it('normalises a composite tuple to one ranking branch joined by the separator', () => {
    const identity = identityTupleToIdentityField([
      'kubernetes.namespace',
      'kubernetes.deployment.name',
    ]);

    expect(identity).toEqual({
      euidRanking: {
        branches: [
          {
            ranking: [
              [
                { field: 'kubernetes.namespace' },
                { sep: IDENTITY_TUPLE_SEPARATOR },
                { field: 'kubernetes.deployment.name' },
              ],
            ],
          },
        ],
      },
      documentsFilter: {
        and: [
          isNotEmptyCondition('kubernetes.namespace'),
          isNotEmptyCondition('kubernetes.deployment.name'),
        ],
      },
    });
  });

  it('preserves tuple order for three fields', () => {
    const identity = identityTupleToIdentityField(['a.cluster', 'b.namespace', 'c.name']);
    if ('singleField' in identity) {
      throw new Error('expected a calculated identity');
    }
    expect(identity.euidRanking.branches[0].ranking[0]).toEqual([
      { field: 'a.cluster' },
      { sep: '/' },
      { field: 'b.namespace' },
      { sep: '/' },
      { field: 'c.name' },
    ]);
  });

  it('produces output that parses against the store identity schema', () => {
    expect(identityFieldSchema.safeParse(identityTupleToIdentityField(['host.name'])).success).toBe(
      true
    );
    expect(
      identityFieldSchema.safeParse(
        identityTupleToIdentityField(['cloud.account.id', 'InstanceId'])
      ).success
    ).toBe(true);
  });

  it('rejects an empty tuple', () => {
    expect(() => identityTupleToIdentityField([])).toThrow(/at least one field/);
  });

  it.each([
    ['an expression', 'COALESCE(k8s.deployment.name, k8s.statefulset.name)'],
    ['a wildcard', 'kubernetes.*'],
    ['whitespace', 'kubernetes.pod uid'],
    ['a backtick-quoted name', '`k8s.pod.phase`'],
    ['a leading dot', '.kubernetes.pod.uid'],
    ['an empty string', ''],
  ])('rejects %s', (_label, field) => {
    expect(() => identityTupleToIdentityField([field])).toThrow(/literal field paths/);
  });

  it('rejects duplicate fields', () => {
    expect(() => identityTupleToIdentityField(['host.name', 'host.name'])).toThrow(/duplicate/);
  });
});
