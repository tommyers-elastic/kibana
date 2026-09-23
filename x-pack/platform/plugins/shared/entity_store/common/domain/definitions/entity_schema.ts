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
import { isNotEmptyCondition } from './common_fields';
import { identityCoreSchema, isSingleFieldIdentity } from './identity_core_schema';
import { inventoryExtensionSchema, isLiteralFieldPath } from './inventory_schema';
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

/** Maximum distinct identity fields supported by inventory definitions and detail requests. */
export const MAX_INVENTORY_IDENTITY_FIELDS = 8;

/**
 * How the inventory query generator reads an `identityField`: one literal field list per ranking
 * composition, in ranking order (a single-field identity is `[[field]]`), and every field in order
 * of first appearance. Rows are grouped `BY` `fields`; one composition means every field must be
 * present (a tuple), several mean alternatives of which the first present one is the id.
 */
export interface InventoryIdentityPlan {
  compositions: string[][];
  fields: string[];
}

/**
 * Derives the inventory identity plan from a definition's `identityField`, for authored and
 * built-in types alike. Field evaluation destinations are computed, not stored, so they are left
 * out as `getEuidSourceFieldsFromDefinition` does.
 */
export function getInventoryIdentityPlan(
  definition: Pick<EntityDefinitionWithoutId, 'identityField'>
): InventoryIdentityPlan {
  const { identityField } = definition;
  if (isSingleFieldIdentity(identityField)) {
    return { compositions: [[identityField.singleField]], fields: [identityField.singleField] };
  }
  const destinations = new Set((identityField.fieldEvaluations ?? []).map((e) => e.destination));
  const compositions = identityField.euidRanking.branches
    .flatMap(({ ranking }) =>
      ranking.map((composition) =>
        composition.flatMap((part) =>
          'field' in part && !destinations.has(part.field) ? [part.field] : []
        )
      )
    )
    .filter((composition) => composition.length > 0);
  return { compositions, fields: [...new Set(compositions.flat())] };
}

const compositionPresenceFilter = (fields: readonly string[]): Condition =>
  fields.length === 1
    ? isNotEmptyCondition(fields[0])
    : { and: fields.map((field) => isNotEmptyCondition(field)) };

/**
 * The `documentsFilter` a servable ranking must carry: every field of a composition present and
 * non-empty, for any of its compositions. This is the filter the built-in `host` declares and the
 * one `identityTupleToIdentityField` derives, so the compiler and the generator agree on which
 * documents carry an identity.
 */
export function getInventoryPresenceFilter(
  compositions: readonly (readonly string[])[]
): Condition {
  return compositions.length === 1
    ? compositionPresenceFilter(compositions[0])
    : { or: compositions.map(compositionPresenceFilter) };
}

/**
 * A definition with an inventory extension is served by grouping on raw mapped fields; the id is
 * computed on the aggregated rows and never per document. Its `identityField` is therefore
 * restricted to the subset the generator can serve: a single literal field, or one unconditional
 * ranking branch whose compositions are literal fields and separators, with the derived presence
 * filter as `documentsFilter`, no field evaluations and the type prefix kept. Attributes and
 * metrics may not repeat an identity field, since every one of them is a column of the same row.
 */
const assertInventoryIdentityIsServable = (
  definition: EntityDefinitionBase,
  ctx: z.RefinementCtx
): void => {
  const { inventory, identityField } = definition;
  if (!inventory) {
    return;
  }
  const issue = (path: PropertyKey[], message: string): void => {
    ctx.addIssue({ code: 'custom', path, message });
  };
  const literalFieldMessage = (field: string): string =>
    `"${field}" must be a literal field path (no expressions, wildcards, quoting or whitespace): the inventory groups on raw mapped fields`;

  if (identityField.skipTypePrepend === true) {
    issue(
      ['identityField', 'skipTypePrepend'],
      'inventory entity ids keep the type prefix; remove skipTypePrepend'
    );
  }

  if (isSingleFieldIdentity(identityField)) {
    if (!isLiteralFieldPath(identityField.singleField)) {
      issue(['identityField', 'singleField'], literalFieldMessage(identityField.singleField));
    }
  } else {
    const { euidRanking, fieldEvaluations, documentsFilter } = identityField;
    if (fieldEvaluations !== undefined) {
      issue(
        ['identityField', 'fieldEvaluations'],
        'the inventory never computes ids per document; remove fieldEvaluations'
      );
    }
    let servableRanking = true;
    if (euidRanking.branches.length !== 1) {
      servableRanking = false;
      issue(
        ['identityField', 'euidRanking', 'branches'],
        `the inventory serves exactly one ranking branch, got ${euidRanking.branches.length}`
      );
    }
    for (const [branchIndex, branch] of euidRanking.branches.entries()) {
      if (branch.when !== undefined) {
        servableRanking = false;
        issue(
          ['identityField', 'euidRanking', 'branches', branchIndex, 'when'],
          'the inventory serves one unconditional ranking branch; remove when'
        );
      }
      for (const [compositionIndex, composition] of branch.ranking.entries()) {
        for (const [partIndex, part] of composition.entries()) {
          if (partIndex === 0 && 'sep' in part) {
            servableRanking = false;
            issue(
              [
                'identityField',
                'euidRanking',
                'branches',
                branchIndex,
                'ranking',
                compositionIndex,
                partIndex,
                'sep',
              ],
              'an inventory identity composition must start with a field, not a separator'
            );
          }
          if ('field' in part && !isLiteralFieldPath(part.field)) {
            servableRanking = false;
            issue(
              [
                'identityField',
                'euidRanking',
                'branches',
                branchIndex,
                'ranking',
                compositionIndex,
                partIndex,
                'field',
              ],
              literalFieldMessage(part.field)
            );
          }
        }
      }
    }
    if (servableRanking) {
      const expected = getInventoryPresenceFilter(
        getInventoryIdentityPlan(definition).compositions
      );
      if (!isEqual(documentsFilter, expected)) {
        issue(
          ['identityField', 'documentsFilter'],
          `documentsFilter must be the presence filter of the ranking (every field of a composition present and non-empty, for any composition); expected ${JSON.stringify(
            expected
          )}`
        );
      }
    }
  }

  const identityFields = new Set(getInventoryIdentityPlan(definition).fields);
  if (identityFields.size > MAX_INVENTORY_IDENTITY_FIELDS) {
    issue(
      ['identityField'],
      `inventory identity must have at most ${MAX_INVENTORY_IDENTITY_FIELDS} distinct fields (got ${identityFields.size})`
    );
  }
  for (const [index, field] of (inventory.attributes ?? []).entries()) {
    if (identityFields.has(field)) {
      issue(['inventory', 'attributes', index], `attribute "${field}" is an identity field`);
    }
  }
  for (const [sourceIndex, source] of inventory.sources.entries()) {
    for (const [index, { name }] of (source.attributes ?? []).entries()) {
      if (identityFields.has(name)) {
        issue(
          ['inventory', 'sources', sourceIndex, 'attributes', index, 'name'],
          `attribute "${name}" repeats an identity field`
        );
      }
    }
    for (const [index, { name }] of (source.metrics ?? []).entries()) {
      if (identityFields.has(name)) {
        issue(
          ['inventory', 'sources', sourceIndex, 'metrics', index, 'name'],
          `metric "${name}" repeats an identity field`
        );
      }
    }
  }
};

/**
 * A definition as authored (no runtime `id`): the body of the definitions API and the input of
 * `registerEntityDefinition`. Same shape and rules as `entitySchema` minus `id`.
 */
export const entityDefinitionInputSchema = entityDefinitionBaseSchema.superRefine(
  assertInventoryIdentityIsServable
);

export const entitySchema = entityDefinitionBaseSchema
  .extend({
    id: z.string().min(1).max(512),
  })
  .superRefine(assertInventoryIdentityIsServable);

/**
 * A definition with its runtime `id`. `inventory` is the authored extension of a dynamic
 * definition or, on a built-in record served by the server registry, the extension attached
 * through `registerInventoryExtension` or the API; both have the same shape and the identity is
 * always the core `identityField`.
 */
export type EntityDefinition = z.infer<typeof entitySchema>;
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
  isInventoryRateAggregation,
} from './inventory_schema';
export type {
  InventoryExtension,
  BuiltInInventoryExtension,
  BuiltInInventoryExtensionDocument,
  InventorySource,
  InventoryMetric,
  InventoryMetricAggregation,
  InventoryRateAggregation,
  InventorySourceAttribute,
  InventoryValueLabels,
} from './inventory_schema';
