/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { conditionSchema as streamlangConditionSchema } from '@kbn/streamlang';
import { z } from '@kbn/zod/v4';

/**
 * Identity core of an entity definition: the part shared by every solution and the only part the
 * EUID compiler needs. It answers "which documents belong to this type" and "how is the entity id
 * composed from a document". Solution-specific concerns (extraction into the store, live inventory
 * queries) are separate extensions that embed this core; nothing in this module imports them.
 *
 * Every user-suppliable string and array is bounded because definitions will be accepted over HTTP.
 */

const MAX_TYPE_LENGTH = 128;
const MAX_NAME_LENGTH = 256;
const MAX_FIELD_NAME_LENGTH = 1024;
const MAX_SEPARATOR_LENGTH = 16;
const MAX_EUID_BRANCHES = 16;
const MAX_EUID_COMPOSITIONS_PER_BRANCH = 32;
const MAX_EUID_PARTS_PER_COMPOSITION = 32;
const MAX_FIELD_EVALUATIONS = 64;
const MAX_FIELD_EVALUATION_SOURCES = 16;
const MAX_FIELD_EVALUATION_WHEN_CLAUSES = 64;
const MAX_FIELD_EVALUATION_SOURCE_MATCHES = 64;
const MAX_FIELD_EVALUATION_MAPPING_ENTRIES = 64;

// DoS guard: cap every user-supplied string in the whenClause schema before it reaches Painless/ESQL generation.
const MAX_FIELD_EVALUATION_STRING_LENGTH = 1000;

/**
 * Entity type name. Lowercase alphanumeric segments separated by `.`, `_` or `-` (e.g. `host`,
 * `k8s.pod`, `gcp.gce_instance`). The type is emitted verbatim as the `<type>:` id prefix in every
 * EUID backend, so characters that need quoting in ES|QL, Painless or KQL are not allowed.
 */
export const ENTITY_TYPE_NAME_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export const entityTypeNameSchema = z
  .string()
  .min(1)
  .max(MAX_TYPE_LENGTH)
  .regex(ENTITY_TYPE_NAME_PATTERN, {
    message:
      'must be lowercase alphanumeric segments separated by ".", "_" or "-" (e.g. "host", "k8s.pod")',
  });

const fieldNameSchema = z.string().min(1).max(MAX_FIELD_NAME_LENGTH);

const euidFieldSchema = z.object({
  field: fieldNameSchema,
});

const euidSeparatorSchema = z.object({
  sep: z.string().max(MAX_SEPARATOR_LENGTH),
});

// Field evaluation: pre-evaluate a field before euid generation (first match wins; fallback to source value or fallbackValue).
const fieldEvaluationWhenClauseSourceMatchSchema = z.object({
  sourceMatchesAny: z
    .array(z.string().max(MAX_FIELD_EVALUATION_STRING_LENGTH))
    .max(MAX_FIELD_EVALUATION_SOURCE_MATCHES),
  then: z.string().max(MAX_FIELD_EVALUATION_STRING_LENGTH),
});
const fieldEvaluationWhenClauseFieldMappingThenSchema = z.object({
  field: z.string().max(MAX_FIELD_EVALUATION_STRING_LENGTH),
  mapping: z
    .record(
      z.string().max(MAX_FIELD_EVALUATION_STRING_LENGTH),
      z.string().max(MAX_FIELD_EVALUATION_STRING_LENGTH)
    )
    .refine((mapping) => Object.keys(mapping).length <= MAX_FIELD_EVALUATION_MAPPING_ENTRIES, {
      message: `mapping must have at most ${MAX_FIELD_EVALUATION_MAPPING_ENTRIES} entries`,
    }),
});

const fieldEvaluationWhenClauseConditionSchema = z.object({
  condition: streamlangConditionSchema,
  then: z.union([
    z.string().max(MAX_FIELD_EVALUATION_STRING_LENGTH),
    fieldEvaluationWhenClauseFieldMappingThenSchema,
  ]),
});
const fieldEvaluationWhenClauseSchema = z.union([
  fieldEvaluationWhenClauseSourceMatchSchema,
  fieldEvaluationWhenClauseConditionSchema,
]);

const fieldEvaluationSourceSchema = z.union([
  z.object({ field: fieldNameSchema }),
  z.object({
    firstChunkOfField: fieldNameSchema,
    splitBy: z.string().min(1).max(MAX_SEPARATOR_LENGTH),
  }),
]);

export const fieldEvaluationSchema = z.object({
  destination: fieldNameSchema,
  sources: z.array(fieldEvaluationSourceSchema).max(MAX_FIELD_EVALUATION_SOURCES),
  fallbackValue: z.string().max(MAX_FIELD_EVALUATION_STRING_LENGTH).nullable(),
  whenClauses: z.array(fieldEvaluationWhenClauseSchema).max(MAX_FIELD_EVALUATION_WHEN_CLAUSES),
});

export const fieldEvaluationsSchema = z.array(fieldEvaluationSchema).max(MAX_FIELD_EVALUATIONS);

const euidCompositionSchema = z
  .array(z.union([euidFieldSchema, euidSeparatorSchema]))
  .min(1)
  .max(MAX_EUID_PARTS_PER_COMPOSITION)
  .refine((parts) => parts.some((part) => 'field' in part), {
    message: 'Each EUID composition must contain at least one field part',
  });

const euidRankingBranchSchema = z.object({
  when: streamlangConditionSchema.optional(),
  ranking: z.array(euidCompositionSchema).min(1).max(MAX_EUID_COMPOSITIONS_PER_BRANCH),
});

export const euidRankingSchema = z.object({
  branches: z.array(euidRankingBranchSchema).min(1).max(MAX_EUID_BRANCHES),
});

// Any field used in the euid calculation must be mapped in the materialisation `fields` array,
// otherwise we won't have guarantees of field being available
const calculatedIdentityFieldLogicSchema = z.object({
  // Ranking mechanism for EUID: branches evaluated in order; first matching branch wins.
  // Branch with no `when` always matches (fallback). Used by ESQL, Painless, Memory, DSL.
  euidRanking: euidRankingSchema,

  // Optional pre-evaluated fields (e.g. entity.namespace from event.module). Applied before
  // euid generation and translated to ESQL, Painless, and in-memory.
  fieldEvaluations: z.optional(fieldEvaluationsSchema),

  // Document-level filter (Condition from @kbn/streamlang). Only documents matching this
  // filter are considered for this entity type. Must express "at least one identity field
  // present" (and any entity-specific rules, e.g. user IDP pre-conditions). Translated to
  // DSL and ESQL via conditionToQueryDsl and conditionToESQL.
  documentsFilter: streamlangConditionSchema,

  // When true, the entity id is not prefixed with the entity type (e.g. output "a" instead of "generic:a").
  skipTypePrepend: z.optional(z.boolean()),
});

/**
 * Single-field identity: entity is identified by one field only (e.g. service.name, entity.id).
 * No composition, no field evaluations. ESQL/DSL use a simplified path for this shape.
 */
export const singleFieldIdentitySchema = z.object({
  singleField: fieldNameSchema,
  // When true, the entity id is not prefixed with the entity type (e.g. output "a" instead of "generic:a").
  skipTypePrepend: z.optional(z.boolean()),
});

export const identityFieldSchema = z.union([
  calculatedIdentityFieldLogicSchema,
  singleFieldIdentitySchema,
]);

/**
 * The shared identity core. `type` is a string at the schema level; the built-in registry narrows
 * it to the closed `EntityType` enum where it needs to.
 */
export const identityCoreSchema = z.object({
  type: entityTypeNameSchema,
  name: z.string().min(1).max(MAX_NAME_LENGTH),
  identityField: identityFieldSchema,
  /**
   * Optional author-declared version of the definition. The store does not maintain it: bump it
   * when the identity changes so readers can tell which ids are comparable.
   */
  version: z.number().int().min(1).optional(),
});

export type EntityIdentityCore = z.infer<typeof identityCoreSchema>;
export type CalculatedEntityIdentity = z.infer<typeof calculatedIdentityFieldLogicSchema>; // full identity (euidRanking + documentsFilter + optional fieldEvaluations)
export type SingleFieldIdentity = z.infer<typeof singleFieldIdentitySchema>;
export type EntityIdentity = z.infer<typeof identityFieldSchema>; // definition-time identity (full or singleField)
export type EuidField = z.infer<typeof euidFieldSchema>;
export type EuidSeparator = z.infer<typeof euidSeparatorSchema>;
export type EuidAttribute = EuidField | EuidSeparator;
export type EuidRankingBranch = z.infer<typeof euidRankingBranchSchema>;
export type EuidRanking = z.infer<typeof euidRankingSchema>;
export type FieldEvaluationWhenClause = z.infer<typeof fieldEvaluationWhenClauseSchema>;
export type FieldEvaluationWhenClauseFieldMappingThen = z.infer<
  typeof fieldEvaluationWhenClauseFieldMappingThenSchema
>;
export type FieldEvaluationSource = z.infer<typeof fieldEvaluationSourceSchema>;
export type FieldEvaluation = z.infer<typeof fieldEvaluationSchema>;

export function isSingleFieldIdentity(identity: EntityIdentity): identity is SingleFieldIdentity {
  return 'singleField' in identity;
}
