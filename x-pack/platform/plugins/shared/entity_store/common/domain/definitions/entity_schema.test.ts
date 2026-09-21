/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { INVENTORY_DEFINITION_FIXTURES } from './__fixtures__/inventory_definitions';
import { isNotEmptyCondition } from './common_fields';
import {
  entityDefinitionInputSchema,
  entitySchema,
  euidRankingSchema,
  getEntityFields,
  getInventoryIdentityPlan,
  getInventoryPresenceFilter,
  getMaterialisation,
  getMaterialisationMode,
  getPostAggFilter,
  getPostStatsFieldOverrides,
  getPreAggFieldOverrides,
  isMaterialisedDefinition,
  setFieldsByConditionSchema,
} from './entity_schema';
import { hostEntityDefinition } from './host';
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

  describe('inventory identity must be servable by the query generator', () => {
    const sources = [{ index: 'metrics-*' }];
    const issuesOf = (definition: object) =>
      entitySchema.safeParse({ id: 'x', ...definition }).error?.issues ?? [];

    it.each(INVENTORY_DEFINITION_FIXTURES.map((definition) => [definition.type, definition]))(
      'accepts the ported %s fixture',
      (type, definition) => {
        const result = entitySchema.safeParse({ ...definition, id: `${type}_default` });
        expect(result.error?.issues).toBeUndefined();
        expect(result.success).toBe(true);
        expect(isMaterialisedDefinition(definition)).toBe(false);
      }
    );

    it('accepts ranked alternatives: one branch, single-field compositions, an any-of documents filter', () => {
      const claim = {
        type: 'claim',
        name: 'claim',
        identityField: {
          euidRanking: {
            branches: [{ ranking: [[{ field: 'halcyon.claim_id' }], [{ field: 'claim_id' }]] }],
          },
          documentsFilter: {
            or: [isNotEmptyCondition('halcyon.claim_id'), isNotEmptyCondition('claim_id')],
          },
        },
        inventory: { sources },
      };
      expect(issuesOf(claim)).toEqual([]);
      expect(getInventoryIdentityPlan(claim)).toEqual({
        compositions: [['halcyon.claim_id'], ['claim_id']],
        fields: ['halcyon.claim_id', 'claim_id'],
      });
    });

    it('accepts a ranking that mixes a composite and a single alternative', () => {
      const mixed = {
        ...core,
        identityField: {
          euidRanking: {
            branches: [
              {
                ranking: [
                  [{ field: 'cloud.account.id' }, { sep: '/' }, { field: 'cloud.instance.id' }],
                  [{ field: 'host.id' }],
                ],
              },
            ],
          },
          documentsFilter: {
            or: [
              {
                and: [
                  isNotEmptyCondition('cloud.account.id'),
                  isNotEmptyCondition('cloud.instance.id'),
                ],
              },
              isNotEmptyCondition('host.id'),
            ],
          },
        },
        inventory: { sources },
      };
      expect(issuesOf(mixed)).toEqual([]);
      expect(getInventoryIdentityPlan(mixed)).toEqual({
        compositions: [['cloud.account.id', 'cloud.instance.id'], ['host.id']],
        fields: ['cloud.account.id', 'cloud.instance.id', 'host.id'],
      });
    });

    it.each([0, 1])(
      'rejects a leading separator in composition %i in both definition schemas',
      (compositionIndex) => {
        const compositions =
          compositionIndex === 0 ? [['resource.id']] : [['primary.id'], ['resource.id']];
        const definition = {
          ...core,
          identityField: {
            euidRanking: {
              branches: [
                {
                  ranking: compositions.map(([field], index) =>
                    index === compositionIndex ? [{ sep: 'prefix/' }, { field }] : [{ field }]
                  ),
                },
              ],
            },
            documentsFilter: getInventoryPresenceFilter(compositions),
          },
          inventory: { sources },
        };
        for (const result of [
          entityDefinitionInputSchema.safeParse(definition),
          entitySchema.safeParse(definition),
        ]) {
          expect(result.success).toBe(false);
          expect(result.error?.issues).toEqual([
            expect.objectContaining({
              path: [
                'identityField',
                'euidRanking',
                'branches',
                0,
                'ranking',
                compositionIndex,
                0,
                'sep',
              ],
              message: 'an inventory identity composition must start with a field, not a separator',
            }),
          ]);
        }
      }
    );

    it('accepts separators between fields and after the last field', () => {
      expect(
        issuesOf({
          ...core,
          identityField: {
            euidRanking: {
              branches: [
                {
                  ranking: [
                    [
                      { field: 'resource.namespace' },
                      { sep: '/' },
                      { field: 'resource.id' },
                      { sep: '/' },
                    ],
                  ],
                },
              ],
            },
            documentsFilter: getInventoryPresenceFilter([['resource.namespace', 'resource.id']]),
          },
          inventory: { sources },
        })
      ).toEqual([]);
    });

    it.each(['tuple', 'ranking'] as const)(
      'limits a %s identity to eight distinct fields in both definition schemas',
      (kind) => {
        const fields = Array.from({ length: 9 }, (_, index) => `resource.key${index}`);
        for (const count of [8, 9]) {
          const selected = fields.slice(0, count);
          const compositions = kind === 'tuple' ? [selected] : selected.map((field) => [field]);
          const definition = {
            ...core,
            identityField: {
              euidRanking: {
                branches: [
                  {
                    ranking: compositions.map((composition) =>
                      composition.map((field) => ({ field }))
                    ),
                  },
                ],
              },
              documentsFilter: getInventoryPresenceFilter(compositions),
            },
            inventory: { sources },
          };
          const results = [
            entityDefinitionInputSchema.safeParse(definition),
            entitySchema.safeParse(definition),
          ];
          for (const result of results) {
            expect(result.success).toBe(count === 8);
            if (!result.success) {
              expect(result.error.issues).toEqual([
                expect.objectContaining({
                  path: ['identityField'],
                  message: 'inventory identity must have at most 8 distinct fields (got 9)',
                }),
              ]);
            }
          }
          expect(
            entityDefinitionInputSchema.safeParse({ ...definition, inventory: undefined }).success
          ).toBe(true);
        }
      }
    );

    it('counts shared fields across ranking compositions only once', () => {
      const fields = Array.from({ length: 8 }, (_, index) => `resource.key${index}`);
      const compositions = [fields, [fields[0]]];
      expect(
        issuesOf({
          ...core,
          identityField: {
            euidRanking: {
              branches: [
                {
                  ranking: compositions.map((composition) =>
                    composition.map((field) => ({ field }))
                  ),
                },
              ],
            },
            documentsFilter: getInventoryPresenceFilter(compositions),
          },
          inventory: { sources },
        })
      ).toEqual([]);
    });

    it('does not restrict a definition without an inventory extension', () => {
      expect(
        issuesOf({
          ...core,
          identityField: {
            euidRanking: {
              branches: [
                { when: { field: 'a', exists: true }, ranking: [[{ field: 'COALESCE(a, b)' }]] },
                { ranking: [[{ field: 'b' }]] },
              ],
            },
            documentsFilter: { always: {} },
          },
        })
      ).toEqual([]);
    });

    it('rejects a documentsFilter that is not the derived presence filter and prints the expected block', () => {
      const expected = {
        and: [
          isNotEmptyCondition('kubernetes.namespace'),
          isNotEmptyCondition('kubernetes.deployment.name'),
        ],
      };
      const issues = issuesOf({
        ...core,
        identityField: {
          euidRanking: {
            branches: [
              {
                ranking: [
                  [
                    { field: 'kubernetes.namespace' },
                    { sep: '/' },
                    { field: 'kubernetes.deployment.name' },
                  ],
                ],
              },
            ],
          },
          documentsFilter: isNotEmptyCondition('kubernetes.deployment.name'),
        },
        inventory: { sources },
      });
      expect(issues.map(({ path }) => path)).toEqual([['identityField', 'documentsFilter']]);
      expect(issues[0].message).toBe(
        `documentsFilter must be the presence filter of the ranking (every field of a composition present and non-empty, for any composition); expected ${JSON.stringify(
          expected
        )}`
      );
    });

    it('rejects a singleField that is not a literal path', () => {
      const issues = issuesOf({
        ...core,
        identityField: { singleField: 'COALESCE(a, b)' },
        inventory: { sources },
      });
      expect(issues.map(({ path }) => path)).toEqual([['identityField', 'singleField']]);
      expect(issues[0].message).toContain('literal field path');
    });

    it('rejects skipTypePrepend: inventory ids keep the type prefix', () => {
      const issues = issuesOf({
        ...core,
        identityField: { singleField: 'kubernetes.pod.uid', skipTypePrepend: true },
        inventory: { sources },
      });
      expect(issues.map(({ path }) => path)).toEqual([['identityField', 'skipTypePrepend']]);
      expect(
        issuesOf({
          ...core,
          identityField: { singleField: 'kubernetes.pod.uid', skipTypePrepend: false },
          inventory: { sources },
        })
      ).toEqual([]);
    });

    it('rejects several branches, a conditional branch, field evaluations and non-literal fields, without checking the filter', () => {
      const issues = issuesOf({
        ...core,
        identityField: {
          euidRanking: {
            branches: [
              { when: { field: 'a', exists: true }, ranking: [[{ field: 'a' }]] },
              { ranking: [[{ field: 'b c' }]] },
            ],
          },
          fieldEvaluations: [
            { destination: 'a', sources: [{ field: 'x' }], fallbackValue: null, whenClauses: [] },
          ],
          documentsFilter: { always: {} },
        },
        inventory: { sources },
      });
      expect(issues.map(({ path }) => path)).toEqual([
        ['identityField', 'fieldEvaluations'],
        ['identityField', 'euidRanking', 'branches'],
        ['identityField', 'euidRanking', 'branches', 0, 'when'],
        ['identityField', 'euidRanking', 'branches', 1, 'ranking', 0, 0, 'field'],
      ]);
      expect(issues[1].message).toBe('the inventory serves exactly one ranking branch, got 2');
    });

    it('rejects attributes and metrics that repeat an identity field', () => {
      const issues = issuesOf({
        ...core,
        identityField: { singleField: 'claim_id' },
        inventory: {
          attributes: ['claim_id'],
          sources: [
            { index: 'traces-*', attributes: [{ name: 'claim_id', field: 'halcyon.claim_id' }] },
            { index: 'logs-*', metrics: [{ name: 'claim_id', field: 'x', agg: 'count' }] },
          ],
        },
      });
      expect(issues.map(({ path, message }) => [path, message])).toEqual([
        [
          ['inventory', 'sources', 0, 'attributes', 0, 'name'],
          'attribute "claim_id" repeats a top-level attribute',
        ],
        [
          ['inventory', 'sources', 0, 'attributes', 0, 'name'],
          '"claim_id" is used as an attribute in one source and as a metric in another',
        ],
        [['inventory', 'attributes', 0], 'attribute "claim_id" is an identity field'],
        [
          ['inventory', 'sources', 0, 'attributes', 0, 'name'],
          'attribute "claim_id" repeats an identity field',
        ],
        [
          ['inventory', 'sources', 1, 'metrics', 0, 'name'],
          'metric "claim_id" repeats an identity field',
        ],
      ]);
    });
  });
});

describe('getInventoryIdentityPlan and getInventoryPresenceFilter', () => {
  it('reads a single field as one composition', () => {
    expect(getInventoryIdentityPlan({ identityField: { singleField: 'service.name' } })).toEqual({
      compositions: [['service.name']],
      fields: ['service.name'],
    });
    expect(getInventoryPresenceFilter([['service.name']])).toEqual(
      isNotEmptyCondition('service.name')
    );
  });

  it('reads a tuple fixture as one composite composition', () => {
    const [, , deployment] = INVENTORY_DEFINITION_FIXTURES;
    expect(getInventoryIdentityPlan(deployment)).toEqual({
      compositions: [['kubernetes.namespace', 'kubernetes.deployment.name']],
      fields: ['kubernetes.namespace', 'kubernetes.deployment.name'],
    });
  });

  it('reads the built-in host ranking and derives its own documents filter', () => {
    const plan = getInventoryIdentityPlan(hostEntityDefinition);
    expect(plan).toEqual({
      compositions: [['host.id'], ['host.name'], ['host.hostname']],
      fields: ['host.id', 'host.name', 'host.hostname'],
    });
    if ('singleField' in hostEntityDefinition.identityField) {
      throw new Error('expected a ranking');
    }
    expect(getInventoryPresenceFilter(plan.compositions)).toEqual(
      hostEntityDefinition.identityField.documentsFilter
    );
  });

  it('deduplicates fields across compositions in order of first appearance', () => {
    expect(
      getInventoryIdentityPlan({
        identityField: {
          euidRanking: {
            branches: [
              { ranking: [[{ field: 'a' }, { sep: ':' }, { field: 'b' }], [{ field: 'b' }]] },
            ],
          },
          documentsFilter: { always: {} },
        },
      })
    ).toEqual({ compositions: [['a', 'b'], ['b']], fields: ['a', 'b'] });
  });
});

describe('entityDefinitionInputSchema (API body / setup registration)', () => {
  it('accepts every inventory fixture without an id', () => {
    for (const fixture of INVENTORY_DEFINITION_FIXTURES) {
      const result = entityDefinitionInputSchema.safeParse(fixture);
      expect(result.success).toBe(true);
    }
  });

  it('applies the same servable-identity rule as entitySchema', () => {
    const [pod] = INVENTORY_DEFINITION_FIXTURES;
    // `kubernetes.pod.name` is a top-level attribute of the pod fixture.
    const result = entityDefinitionInputSchema.safeParse({
      ...pod,
      identityField: { singleField: 'kubernetes.pod.name' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['inventory', 'attributes', 0]);
    }
    const built = buildInventoryEntityDefinition({
      type: 'k8s.deployment',
      name: 'deployment',
      identity: ['kubernetes.namespace', 'kubernetes.deployment.name'],
      inventory: { sources: [{ index: 'metrics-*' }] },
    });
    expect(entityDefinitionInputSchema.safeParse(built).success).toBe(true);
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
