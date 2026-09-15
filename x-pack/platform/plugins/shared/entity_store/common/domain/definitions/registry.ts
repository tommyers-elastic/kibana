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
import { hostEntityDefinition } from './host';
import { userEntityDefinition } from './user';
import { serviceEntityDefinition } from './service';
import { genericEntityDefinition } from './generic';

/**
 * The closed registry of built-in Security definitions. All four are materialised (extracted into
 * the store); that invariant is enforced by the `satisfies` clause so server code that owns
 * templates, tasks and CRUD can read `materialisation` without narrowing.
 */
const entitiesDefinitionRegistry = {
  host: hostEntityDefinition,
  user: userEntityDefinition,
  service: serviceEntityDefinition,
  generic: genericEntityDefinition,
} as const satisfies Record<EntityType, MaterialisedEntityDefinitionWithoutId>;

const BUILT_IN_DEFINITIONS: readonly EntityDefinitionWithoutId[] = Object.values(
  entitiesDefinitionRegistry
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

export function getEntityDefinition(type: EntityType, namespace: string): ManagedEntityDefinition {
  const definition = getEntityDefinitionWithoutId(type);

  return {
    ...definition,
    id: getEntityDefinitionId(type, namespace),
    type,
  };
}

export function getEntityDefinitionWithoutId(
  type: EntityType
): MaterialisedEntityDefinitionWithoutId {
  const definition = entitiesDefinitionRegistry[type];
  assert(definition, `No entity description found for type: ${type}`);

  return definition;
}

/**
 * Types whose definitions are materialised (`materialisation.mode === 'extraction'`). Only these
 * get component templates, extraction tasks, install/start/stop steps and CRUD writes.
 * Defaults to the built-in registry; pass `definitions` to evaluate another set (tests, later a
 * dynamic registry).
 */
export function getMaterialisedEntityTypes<T extends EntityDefinitionWithoutId>(
  definitions: readonly T[]
): Array<T['type']>;
export function getMaterialisedEntityTypes(): EntityType[];
export function getMaterialisedEntityTypes(
  definitions: readonly EntityDefinitionWithoutId[] = BUILT_IN_DEFINITIONS
): string[] {
  return definitions.filter(isMaterialisedDefinition).map(({ type }) => type);
}

/** Whether a built-in type is materialised. Non-materialised types have no index to write to. */
export function isMaterialisedEntityType(type: EntityType): boolean {
  return isMaterialisedDefinition(getEntityDefinitionWithoutId(type));
}

/** Built-in materialised definitions stamped with the per-space id. */
export function getMaterialisedEntityDefinitions(namespace: string): ManagedEntityDefinition[] {
  return getMaterialisedEntityTypes().map((type) => getEntityDefinition(type, namespace));
}
