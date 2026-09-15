/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { isEqual } from 'lodash';
import { z } from '@kbn/zod/v4';
import type { Condition } from '@kbn/streamlang';
import { identityCoreSchema } from './identity_core_schema';
import { identityTupleToIdentityField } from './identity_tuple';
import { inventoryExtensionSchema } from './inventory_schema';
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

export type EntityType = z.infer<typeof EntityType>;
/** The closed set of built-in, code-defined Security types. Dynamic types are a later stage. */
export const EntityType = z.enum(['user', 'host', 'service', 'generic']);

export const ALL_ENTITY_TYPES = Object.values(EntityType.enum);

/** Which extraction process a task is running as. */
export type ExtractionMode = z.infer<typeof ExtractionMode>;
export const ExtractionMode = z.enum(['single', 'priority', 'nonPriority']);

export const entitySchema = identityCoreSchema
  .extend({
    id: z.string().min(1).max(512),
    // Absent means `mode: 'none'`: the definition is never extracted into the store.
    materialisation: z.optional(materialisationSchema),
    inventory: z.optional(inventoryExtensionSchema),
  })
  .superRefine((definition, ctx) => {
    if (!definition.inventory) {
      return;
    }
    // The compiler reads `identityField`, the inventory query generator reads `inventory.identity`;
    // both must describe the same tuple.
    const expected = identityTupleToIdentityField(definition.inventory.identity);
    if (!isEqual(definition.identityField, expected)) {
      ctx.addIssue({
        code: 'custom',
        path: ['identityField'],
        message:
          'identityField must be the normalised form of inventory.identity (see identityTupleToIdentityField)',
      });
    }
  });

export type EntityDefinition = z.infer<typeof entitySchema>; // entity with id generated in runtime
export type EntityDefinitionWithoutId = Omit<EntityDefinition, 'id'>;

/** A definition whose materialisation mode is `extraction`: it has fields, templates and tasks. */
export type MaterialisedEntityDefinition = EntityDefinition & {
  materialisation: ExtractionMaterialisation;
};
export type MaterialisedEntityDefinitionWithoutId = Omit<MaterialisedEntityDefinition, 'id'>;

/** A built-in Security definition: known closed `type` and extraction materialisation. */
export type ManagedEntityDefinition = MaterialisedEntityDefinition & { type: EntityType };

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

export { inventoryExtensionSchema } from './inventory_schema';
export type {
  InventoryExtension,
  InventorySource,
  InventorySourceEngine,
  InventoryMetric,
  InventoryCapture,
  InventoryLookup,
  InventoryMetadataWrite,
  InventorySort,
} from './inventory_schema';
