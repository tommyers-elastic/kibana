/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { ALL_ENTITY_TYPES, entitySchema } from './entity_schema';
import { buildInventoryEntityDefinition } from './inventory_definition';
import {
  getEntityDefinitionWithoutId,
  getMaterialisedEntityDefinitions,
  getMaterialisedEntityTypes,
  hasPriorityVariant,
  isMaterialisedEntityType,
  resolveExtractionMode,
} from './registry';

/**
 * Tests that all entity definitions parse against the entitySchema (does not throw errors)
 */
describe('entitiesDefinitionRegistry', () => {
  it.each(ALL_ENTITY_TYPES)('%s definition parses against entitySchema', (entityType) => {
    const definition = getEntityDefinitionWithoutId(entityType);

    expect(() => entitySchema.parse({ ...definition, id: entityType })).not.toThrow();
  });
});

describe('hasPriorityVariant', () => {
  it.each(ALL_ENTITY_TYPES)('%s: returns false', (type) => {
    expect(hasPriorityVariant(type)).toBe(false);
  });
});

describe('resolveExtractionMode', () => {
  it.each(ALL_ENTITY_TYPES)('%s: returns single when flag is off', (type) => {
    expect(resolveExtractionMode(false, type)).toBe('single');
  });

  it.each(ALL_ENTITY_TYPES)(
    '%s: returns single when flag is on and no priority variant is registered',
    (type) => {
      expect(resolveExtractionMode(true, type)).toBe('single');
    }
  );
});

describe('materialised entity types', () => {
  it('reports every built-in type as materialised', () => {
    expect(getMaterialisedEntityTypes()).toEqual(ALL_ENTITY_TYPES);
    for (const type of ALL_ENTITY_TYPES) {
      expect(isMaterialisedEntityType(type)).toBe(true);
    }
  });

  it('stamps the per-space id on materialised definitions', () => {
    const definitions = getMaterialisedEntityDefinitions('space-a');
    expect(definitions.map(({ type }) => type)).toEqual(ALL_ENTITY_TYPES);
    expect(definitions.map(({ id }) => id)).toEqual(
      ALL_ENTITY_TYPES.map((type) => `security_${type}_space-a`)
    );
  });

  it('filters out definitions whose materialisation mode is none or absent', () => {
    const inventoryOnly = buildInventoryEntityDefinition({
      type: 'k8s.pod',
      name: 'pod',
      inventory: {
        identity: ['kubernetes.pod.uid'],
        sources: [{ index: 'metrics-*', engine: 'TS' }],
      },
    });
    const bareCore = {
      type: 'k8s.node',
      name: 'node',
      identityField: { singleField: 'kubernetes.node.name' },
    };

    expect(
      getMaterialisedEntityTypes([
        getEntityDefinitionWithoutId('host'),
        inventoryOnly,
        bareCore,
        getEntityDefinitionWithoutId('service'),
      ])
    ).toEqual(['host', 'service']);
    expect(getMaterialisedEntityTypes([inventoryOnly, bareCore])).toEqual([]);
  });
});
