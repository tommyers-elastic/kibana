/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { isEqual } from 'lodash';
import { z } from '@kbn/zod/v4';
import type { Condition } from '@kbn/streamlang';
import { ALL_BUILT_IN_ENTITY_TYPES, BuiltInEntityType } from './built_in_entity_types';
import { identityCoreSchema } from './identity_core_schema';
import { identityTupleToIdentityField } from './identity_tuple';
import {
  inventoryExtensionSchema,
  type BuiltInInventoryExtension,
  type InventoryExtension,
} from './inventory_schema';
import {
  materialisationSchema,
  type EntityField,
  type ExtractionMaterialisation,
  type MaterialisationMode,
  type SetFieldsByCondition,
} from './materialisation_schema';

/**
 * An entity definition is a shared identity core plus optional, independently validated
 * solution extensions:
 *
 * - `identity_core_schema.ts`: type, name and identity (consumed by the EUID compiler).
 * - `materialisation_schema.ts`: extraction into the entity store (Security).
 * - `inventory_schema.ts`: live inventory queries over telemetry (Observability).
 *
 * This module composes them into `entitySchema` and re-exports every schema and type so existing
 * imports keep working.
 */

/**
 * An entity type name: one of the built-in Security types or a dynamically registered definition
 * (validated by `entityTypeNameSchema`). Code that is built-in only (engines, extraction, CRUD
 * writes) narrows with `isBuiltInEntityType` or `BuiltInEntityType`.
 */
export type EntityType = string;
/**
 * @deprecated Value alias kept for existing callers that validate against the closed built-in set;
 * use `BuiltInEntityType`. As a type, `EntityType` is now any type name.
 */
export const EntityType = BuiltInEntityType;

/** @deprecated Use `ALL_BUILT_IN_ENTITY_TYPES`: dynamic definitions are not in this list. */
export const ALL_ENTITY_TYPES = ALL_BUILT_IN_ENTITY_TYPES;

export {
  BuiltInEntityType,
  ALL_BUILT_IN_ENTITY_TYPES,
  isBuiltInEntityType,
} from './built_in_entity_types';

/** Which extraction process a task is running as. */
export type ExtractionMode = z.infer<typeof ExtractionMode>;
export const ExtractionMode = z.enum(['single', 'priority', 'nonPriority']);

const entityDefinitionBaseSchema = identityCoreSchema.extend({
  // Absent means `mode: 'none'`: the definition is never extracted into the store.
  materialisation: z.optional(materialisationSchema),
  inventory: z.optional(inventoryExtensionSchema),
});

type EntityDefinitionBase = z.infer<typeof entityDefinitionBaseSchema>;

// The compiler reads `identityField`, the inventory query generator reads `inventory.identity`;
// both must describe the same tuple.
const assertIdentityConsistency = (
  definition: EntityDefinitionBase,
  ctx: z.RefinementCtx
): void => {
  if (!definition.inventory) {
    return;
  }
  const expected = identityTupleToIdentityField(definition.inventory.identity);
  if (!isEqual(definition.identityField, expected)) {
    ctx.addIssue({
      code: 'custom',
      path: ['identityField'],
      message:
        'identityField must be the normalised form of inventory.identity (see identityTupleToIdentityField)',
    });
  }
};

/**
 * A definition as authored (no runtime `id`): the body of the definitions API and the input of
 * `registerEntityDefinition`. Same shape and rules as `entitySchema` minus `id`.
 */
export const entityDefinitionInputSchema =
  entityDefinitionBaseSchema.superRefine(assertIdentityConsistency);

export const entitySchema = entityDefinitionBaseSchema
  .extend({
    id: z.string().min(1).max(512),
  })
  .superRefine(assertIdentityConsistency);

type ParsedEntityDefinition = z.infer<typeof entitySchema>;

/**
 * A definition with its runtime `id`. `inventory` is either the authored extension (dynamic
 * definitions, carrying `identity`) or, on a built-in record served by the server registry, a
 * `BuiltInInventoryExtension` attached through `registerInventoryExtension`, whose identity is
 * the core `identityField`. The schemas above only ever parse the authored form.
 */
export type EntityDefinition = Omit<ParsedEntityDefinition, 'inventory'> & {
  inventory?: InventoryExtension | BuiltInInventoryExtension;
};
export type EntityDefinitionWithoutId = Omit<EntityDefinition, 'id'>;

/** A definition whose materialisation mode is `extraction`: it has fields, templates and tasks. */
export type MaterialisedEntityDefinition = EntityDefinition & {
  materialisation: ExtractionMaterialisation;
};
export type MaterialisedEntityDefinitionWithoutId = Omit<MaterialisedEntityDefinition, 'id'>;

/** A built-in Security definition: known closed `type` and extraction materialisation. */
export type ManagedEntityDefinition = MaterialisedEntityDefinition & { type: BuiltInEntityType };

type HasMaterialisation = Pick<EntityDefinitionWithoutId, 'materialisation'>;

export function getMaterialisationMode(definition: HasMaterialisation): MaterialisationMode {
  return definition.materialisation?.mode ?? 'none';
}

export function isMaterialisedDefinition<T extends HasMaterialisation>(
  definition: T
): definition is T & { materialisation: ExtractionMaterialisation } {
  return definition.materialisation?.mode === 'extraction';
}

/** The extraction extension, or `undefined` for a non-materialised definition. */
export function getMaterialisation(
  definition: HasMaterialisation
): ExtractionMaterialisation | undefined {
  return isMaterialisedDefinition(definition) ? definition.materialisation : undefined;
}

export function getEntityFields(definition: HasMaterialisation): EntityField[] {
  return getMaterialisation(definition)?.fields ?? [];
}

export function getPostAggFilter(definition: HasMaterialisation): Condition | undefined {
  return getMaterialisation(definition)?.postAggFilter;
}

export function getPreAggFieldOverrides(definition: HasMaterialisation): SetFieldsByCondition[] {
  return getMaterialisation(definition)?.whenConditionTrueSetFieldsPreAgg ?? [];
}

export function getPostStatsFieldOverrides(definition: HasMaterialisation): SetFieldsByCondition[] {
  return getMaterialisation(definition)?.whenConditionTrueSetFieldsAfterStats ?? [];
}

/**
 * The authored identity tuple of an inventory extension, or `undefined` when the definition has
 * no inventory extension or carries a built-in extension (whose identity is `identityField`).
 */
export function getInventoryIdentity(
  definition: Pick<EntityDefinitionWithoutId, 'inventory'>
): string[] | undefined {
  const { inventory } = definition;
  return inventory !== undefined && 'identity' in inventory ? inventory.identity : undefined;
}

export {
  identityCoreSchema,
  identityFieldSchema,
  euidRankingSchema,
  singleFieldIdentitySchema,
  fieldEvaluationSchema,
  entityTypeNameSchema,
  ENTITY_TYPE_NAME_PATTERN,
  isSingleFieldIdentity,
} from './identity_core_schema';
export type {
  EntityIdentityCore,
  CalculatedEntityIdentity,
  SingleFieldIdentity,
  EntityIdentity,
  EuidField,
  EuidSeparator,
  EuidAttribute,
  EuidRankingBranch,
  EuidRanking,
  FieldEvaluationWhenClause,
  FieldEvaluationWhenClauseFieldMappingThen,
  FieldEvaluationSource,
  FieldEvaluation,
} from './identity_core_schema';

export {
  materialisationSchema,
  extractionMaterialisationSchema,
  noMaterialisationSchema,
  setFieldsByConditionSchema,
  creationRejectionReasonSchema,
} from './materialisation_schema';
export type {
  EntityField,
  FieldValueSchema,
  SetFieldsByCondition,
  CreationRejectionReason,
  CreatableFromSingleDocument,
  MaterialisationExtension,
  ExtractionMaterialisation,
  MaterialisationMode,
} from './materialisation_schema';

export {
  inventoryExtensionSchema,
  builtInInventoryExtensionSchema,
  builtInInventoryExtensionDocumentSchema,
  isBuiltInInventoryExtensionDocument,
} from './inventory_schema';
export type {
  InventoryExtension,
  BuiltInInventoryExtension,
  BuiltInInventoryExtensionDocument,
  InventorySource,
  InventoryMetric,
  InventoryMetricAggregation,
  InventorySourceAttribute,
  InventoryValueLabels,
} from './inventory_schema';
