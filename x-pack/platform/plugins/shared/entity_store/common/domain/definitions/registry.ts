/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import assert from 'assert';

import type {
  EntityDefinitionWithoutId,
  EntityType,
  ExtractionMode,
  ManagedEntityDefinition,
  MaterialisedEntityDefinitionWithoutId,
} from './entity_schema';
import { isMaterialisedDefinition } from './entity_schema';
import {
  ALL_BUILT_IN_ENTITY_TYPES,
  isBuiltInEntityType,
  type BuiltInEntityType,
} from './built_in_entity_types';
import { hostEntityDefinition } from './host';
import { userEntityDefinition } from './user';
import { serviceEntityDefinition } from './service';
import { genericEntityDefinition } from './generic';

/**
 * The static registry of built-in Security definitions, keyed by the closed built-in type enum.
 * All four are materialised (extracted into the store); that invariant is enforced by the
 * `satisfies` clause so server code that owns templates, tasks and CRUD can read
 * `materialisation` without narrowing.
 *
 * Dynamic (code- or API-registered) definitions are not here: they are resolved by the server-side
 * `EntityDefinitionRegistry`, which layers them over these built-ins per space. Everything in this
 * module is synchronous and built-in only, which is what the type-name EUID compiler entry points
 * and the materialisation code paths need.
 */
const entitiesDefinitionRegistry = {
  host: hostEntityDefinition,
  user: userEntityDefinition,
  service: serviceEntityDefinition,
  generic: genericEntityDefinition,
} as const satisfies Record<BuiltInEntityType, MaterialisedEntityDefinitionWithoutId>;

// Enum order, not object-key order: `composed_of` in the index templates is order-sensitive.
const BUILT_IN_DEFINITIONS: readonly EntityDefinitionWithoutId[] = ALL_BUILT_IN_ENTITY_TYPES.map(
  (type) => entitiesDefinitionRegistry[type]
);

/** Stub: always false until priority definition variants are registered. */
export const hasPriorityVariant = (_type: EntityType): boolean => false;

/** 'nonPriority' is excluded: the non-priority task hardcodes its own identity directly. */
export const resolveExtractionMode = (
  isDualProcessEnabled: boolean,
  entityType: EntityType
): Extract<ExtractionMode, 'priority' | 'single'> => {
  if (isDualProcessEnabled && hasPriorityVariant(entityType)) return 'priority';
  return 'single';
};

export const getEntityDefinitionId = (entityType: EntityType, space: string) =>
  `security_${entityType}_${space}`;

function assertBuiltInEntityType(type: string): asserts type is BuiltInEntityType {
  assert(isBuiltInEntityType(type), `No entity description found for type: ${type}`);
}

/**
 * Built-in definition stamped with the per-space id. Throws for any other type name: dynamic
 * definitions have no engine and are resolved through the server-side registry.
 */
export function getEntityDefinition(type: EntityType, namespace: string): ManagedEntityDefinition {
  assertBuiltInEntityType(type);
  const definition = entitiesDefinitionRegistry[type];

  return {
    ...definition,
    id: getEntityDefinitionId(type, namespace),
    type,
  };
}

/** Built-in definition without a per-space id. Throws for any other type name. */
export function getEntityDefinitionWithoutId(
  type: EntityType
): MaterialisedEntityDefinitionWithoutId {
  assertBuiltInEntityType(type);
  return entitiesDefinitionRegistry[type];
}

/**
 * Types whose definitions are materialised (`materialisation.mode === 'extraction'`). Only these
 * get component templates, extraction tasks, install/start/stop steps and CRUD writes.
 * Defaults to the built-in registry; pass `definitions` to evaluate another set (tests, the
 * server-side registry).
 */
export function getMaterialisedEntityTypes<T extends EntityDefinitionWithoutId>(
  definitions: readonly T[]
): Array<T['type']>;
export function getMaterialisedEntityTypes(): BuiltInEntityType[];
export function getMaterialisedEntityTypes(
  definitions?: readonly EntityDefinitionWithoutId[]
): string[] {
  if (definitions === undefined) {
    return ALL_BUILT_IN_ENTITY_TYPES.filter((type) =>
      isMaterialisedDefinition(entitiesDefinitionRegistry[type])
    );
  }
  return definitions.filter(isMaterialisedDefinition).map(({ type }) => type);
}

/**
 * Whether a type is materialised. Only built-ins can be; any other name (a dynamic definition,
 * or a typo) is not, so this is safe to call with unvalidated input.
 */
export function isMaterialisedEntityType(type: EntityType): type is BuiltInEntityType {
  return isBuiltInEntityType(type) && isMaterialisedDefinition(entitiesDefinitionRegistry[type]);
}

/** Built-in materialised definitions stamped with the per-space id. */
export function getMaterialisedEntityDefinitions(namespace: string): ManagedEntityDefinition[] {
  return getMaterialisedEntityTypes().map((type) => getEntityDefinition(type, namespace));
}

export { BUILT_IN_DEFINITIONS };
