/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { INVENTORY_DEFINITION_FIXTURES } from './__fixtures__/inventory_definitions';
import {
  entityDefinitionInputSchema,
  entitySchema,
  euidRankingSchema,
  getEntityFields,
  getMaterialisation,
  getMaterialisationMode,
  getPostAggFilter,
  getPostStatsFieldOverrides,
  getPreAggFieldOverrides,
  isMaterialisedDefinition,
  setFieldsByConditionSchema,
} from './entity_schema';
import { buildInventoryEntityDefinition } from './inventory_definition';

describe('setFieldsByConditionSchema', () => {
  const alwaysCondition = { always: {} as const };

  it('should accept a payload with at least one field override', () => {
    const parsed = setFieldsByConditionSchema.safeParse({
      condition: alwaysCondition,
      fields: { 'entity.namespace': 'local' },
    });
    expect(parsed.success).toBe(true);
  });

  it('should accept a composition override when fields has at least one entry', () => {
    const parsed = setFieldsByConditionSchema.safeParse({
      condition: alwaysCondition,
      fields: {
        'user.name': { composition: { fields: ['user.id', 'host.name'], sep: '@' } },
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('should reject an empty fields map', () => {
    const result = setFieldsByConditionSchema.safeParse({
      condition: alwaysCondition,
      fields: {},
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.message === 'At least one field override is required')
      ).toBe(true);
    }
  });

  it('should reject a composition value with an empty fields array', () => {
    const result = setFieldsByConditionSchema.safeParse({
      condition: alwaysCondition,
      fields: {
        'entity.id': { composition: { fields: [], sep: '@' } },
      },
    });
    expect(result.success).toBe(false);
  });
});

describe('euidRankingSchema', () => {
  const minimalValid = {
    branches: [{ ranking: [[{ field: 'user.email' }]] }],
  };

  it('should accept a minimal valid ranking (one branch, one composition with a field)', () => {
    expect(euidRankingSchema.safeParse(minimalValid).success).toBe(true);
  });

  it('should accept a composition that mixes separators and fields', () => {
    const parsed = euidRankingSchema.safeParse({
      branches: [
        {
          ranking: [[{ field: 'user.name' }, { sep: '@' }, { field: 'user.domain' }]],
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('should reject empty branches', () => {
    const parsed = euidRankingSchema.safeParse({ branches: [] });
    expect(parsed.success).toBe(false);
  });

  it('should reject a branch with empty ranking', () => {
    const parsed = euidRankingSchema.safeParse({
      branches: [{ ranking: [] }],
    });
    expect(parsed.success).toBe(false);
  });

  it('should reject an empty composition', () => {
    const parsed = euidRankingSchema.safeParse({
      branches: [{ ranking: [[]] }],
    });
    expect(parsed.success).toBe(false);
  });

  it('should reject a composition with only separators (no field)', () => {
    const parsed = euidRankingSchema.safeParse({
      branches: [{ ranking: [[{ sep: '@' }, { sep: '.' }]] }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe('entitySchema (identity core + extensions)', () => {
  const core = {
    id: 'k8s_pod_default',
    type: 'k8s.pod',
    name: 'K8s pod',
    identityField: { singleField: 'kubernetes.pod.uid' },
  };

  it('accepts a bare identity core (no extensions) and treats it as non-materialised', () => {
    const parsed = entitySchema.parse(core);
    expect(parsed.materialisation).toBeUndefined();
    expect(getMaterialisationMode(parsed)).toBe('none');
    expect(isMaterialisedDefinition(parsed)).toBe(false);
    expect(getMaterialisation(parsed)).toBeUndefined();
    expect(getEntityFields(parsed)).toEqual([]);
    expect(getPostAggFilter(parsed)).toBeUndefined();
    expect(getPreAggFieldOverrides(parsed)).toEqual([]);
    expect(getPostStatsFieldOverrides(parsed)).toEqual([]);
  });

  it('accepts an explicit materialisation mode of none', () => {
    const parsed = entitySchema.parse({ ...core, materialisation: { mode: 'none' } });
    expect(getMaterialisationMode(parsed)).toBe('none');
    expect(isMaterialisedDefinition(parsed)).toBe(false);
  });

  it('rejects extraction keys on a materialisation of mode none', () => {
    const result = entitySchema.safeParse({
      ...core,
      materialisation: { mode: 'none', fields: [] },
    });
    expect(result.success).toBe(false);
  });

  it('exposes the extraction extension through the accessors', () => {
    const postAggFilter = { field: 'entity.id', exists: true } as const;
    const override = { condition: { always: {} }, fields: { 'entity.name': 'x' } } as const;
    const parsed = entitySchema.parse({
      ...core,
      materialisation: {
        mode: 'extraction',
        fields: [{ source: 'a', destination: 'a', retention: { operation: 'collect_values' } }],
        postAggFilter,
        whenConditionTrueSetFieldsPreAgg: [override],
        whenConditionTrueSetFieldsAfterStats: [override, override],
      },
    });
    expect(getMaterialisationMode(parsed)).toBe('extraction');
    expect(isMaterialisedDefinition(parsed)).toBe(true);
    expect(getEntityFields(parsed)).toHaveLength(1);
    expect(getPostAggFilter(parsed)).toEqual(postAggFilter);
    expect(getPreAggFieldOverrides(parsed)).toHaveLength(1);
    expect(getPostStatsFieldOverrides(parsed)).toHaveLength(2);
  });

  it('requires fields on an extraction materialisation', () => {
    expect(
      entitySchema.safeParse({ ...core, materialisation: { mode: 'extraction' } }).success
    ).toBe(false);
  });

  it.each(['host', 'k8s.pod', 'gcp.gce_instance', 'aws.ec2-instance', 'my_type1'])(
    'accepts type name %s',
    (type) => {
      expect(entitySchema.safeParse({ ...core, type }).success).toBe(true);
    }
  );

  it.each(['Host', 'k8s:pod', 'k8s..pod', '.pod', 'pod.', 'k8s pod', 'k8s/pod', 'k8s"pod', ''])(
    'rejects type name %j',
    (type) => {
      expect(entitySchema.safeParse({ ...core, type }).success).toBe(false);
    }
  );

  it('rejects the removed indexPatterns key silently by stripping it (non-strict core)', () => {
    const parsed = entitySchema.parse({ ...core, indexPatterns: ['logs-*'] });
    expect(parsed).not.toHaveProperty('indexPatterns');
  });

  describe('inventory extension consistency', () => {
    it.each(INVENTORY_DEFINITION_FIXTURES.map((definition) => [definition.type, definition]))(
      'accepts the ported %s fixture',
      (type, definition) => {
        const result = entitySchema.safeParse({ ...definition, id: `${type}_default` });
        expect(result.error?.issues).toBeUndefined();
        expect(result.success).toBe(true);
        expect(isMaterialisedDefinition(definition)).toBe(false);
      }
    );

    it('rejects an identityField that does not match inventory.identity', () => {
      const definition = buildInventoryEntityDefinition({
        type: 'k8s.deployment',
        name: 'deployment',
        inventory: {
          identity: ['kubernetes.namespace', 'kubernetes.deployment.name'],
          sources: [{ index: 'metrics-*' }],
        },
      });
      const result = entitySchema.safeParse({
        ...definition,
        id: 'x',
        identityField: { singleField: 'kubernetes.deployment.name' },
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].path).toEqual(['identityField']);
    });
  });
});

describe('entityDefinitionInputSchema (API body / setup registration)', () => {
  it('accepts every inventory fixture without an id', () => {
    for (const fixture of INVENTORY_DEFINITION_FIXTURES) {
      const result = entityDefinitionInputSchema.safeParse(fixture);
      expect(result.success).toBe(true);
    }
  });

  it('applies the same identity consistency rule as entitySchema', () => {
    const [pod] = INVENTORY_DEFINITION_FIXTURES;
    const result = entityDefinitionInputSchema.safeParse({
      ...pod,
      identityField: { singleField: 'kubernetes.pod.name' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['identityField']);
    }
  });

  it('accepts a bare identity core and a materialised core alike (the registry decides what is registrable)', () => {
    expect(
      entityDefinitionInputSchema.safeParse({
        type: 'k8s.pod',
        name: 'pod',
        identityField: { singleField: 'kubernetes.pod.uid' },
      }).success
    ).toBe(true);
    expect(
      entityDefinitionInputSchema.safeParse({
        type: 'k8s.pod',
        name: 'pod',
        identityField: { singleField: 'kubernetes.pod.uid' },
        materialisation: { mode: 'extraction', fields: [] },
      }).success
    ).toBe(true);
  });
});
