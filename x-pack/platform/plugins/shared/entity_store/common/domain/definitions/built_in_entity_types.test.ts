/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { INVENTORY_DEFINITION_FIXTURES } from './__fixtures__/inventory_definitions';
import {
  ALL_BUILT_IN_ENTITY_TYPES,
  BuiltInEntityType,
  isBuiltInEntityType,
} from './built_in_entity_types';
import { ALL_ENTITY_TYPES, EntityType } from './entity_schema';
import {
  BUILT_IN_DEFINITIONS,
  getEntityDefinition,
  getEntityDefinitionWithoutId,
  getMaterialisedEntityTypes,
  isMaterialisedEntityType,
} from './registry';

describe('built-in entity types', () => {
  it('keeps the four Security types in enum order', () => {
    expect(ALL_BUILT_IN_ENTITY_TYPES).toEqual(['user', 'host', 'service', 'generic']);
    expect(BuiltInEntityType.options).toEqual(ALL_BUILT_IN_ENTITY_TYPES);
  });

  it('keeps the deprecated EntityType value and ALL_ENTITY_TYPES as aliases of the built-in set', () => {
    expect(EntityType).toBe(BuiltInEntityType);
    expect(ALL_ENTITY_TYPES).toBe(ALL_BUILT_IN_ENTITY_TYPES);
    expect(EntityType.safeParse('k8s.pod').success).toBe(false);
  });

  it('narrows a type name to the built-in set', () => {
    expect(isBuiltInEntityType('host')).toBe(true);
    expect(isBuiltInEntityType('k8s.pod')).toBe(false);
    expect(isBuiltInEntityType('')).toBe(false);
  });
});

describe('dynamic types and the static registry', () => {
  it('never reports a dynamic type as materialised, so no engine, template or task is derived for it', () => {
    for (const { type } of INVENTORY_DEFINITION_FIXTURES) {
      expect(isMaterialisedEntityType(type)).toBe(false);
    }
    expect(isMaterialisedEntityType('not.a.type')).toBe(false);
    expect(getMaterialisedEntityTypes()).toEqual(ALL_BUILT_IN_ENTITY_TYPES);
    expect(
      getMaterialisedEntityTypes([...BUILT_IN_DEFINITIONS, ...INVENTORY_DEFINITION_FIXTURES])
    ).toEqual(ALL_BUILT_IN_ENTITY_TYPES);
  });

  it('throws from the synchronous built-in lookups for a dynamic type name', () => {
    expect(() => getEntityDefinitionWithoutId('k8s.pod')).toThrow(/No entity description found/);
    expect(() => getEntityDefinition('k8s.pod', 'default')).toThrow(/No entity description found/);
  });
});
