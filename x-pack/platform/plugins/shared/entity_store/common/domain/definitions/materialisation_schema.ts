/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { conditionSchema as streamlangConditionSchema } from '@kbn/streamlang';
import { z } from '@kbn/zod/v4';
import { fieldEvaluationsSchema } from './identity_core_schema';

/**
 * Materialisation (Security / extraction) extension of an entity definition: everything the
 * extraction engine, the component templates and the CRUD API read when an entity type is
 * materialised into the entity store.
 *
 * `mode: 'extraction'` is the behaviour of the four built-in Security types. `mode: 'none'` marks a
 * definition that is never extracted: no component template, no extraction task, no install step
 * and no CRUD writes, while remaining fully usable by the EUID compiler.
 */

const MAX_FIELD_NAME_LENGTH = 1024;
const MAX_FIELDS = 2000; // matches the latest index `total_fields.limit`
const MAX_SET_FIELDS_RULES = 64;
const MAX_SET_FIELDS_PER_RULE = 64;
const MAX_COMPOSITION_FIELDS = 32;
const MAX_LITERAL_LENGTH = 1000;
const MAX_ENTITY_TYPE_FALLBACK_LENGTH = 256;

const mappingSchema = z.any();

const retentionOperationSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('collect_values') }),
  z.object({ operation: z.literal('prefer_newest_value') }),
  z.object({ operation: z.literal('prefer_oldest_value') }),
  z.object({ operation: z.literal('managed') }),
]);

const fieldNameSchema = z.string().min(1).max(MAX_FIELD_NAME_LENGTH);

const fieldSchema = z.object({
  allowAPIUpdate: z.optional(z.boolean()),
  destination: fieldNameSchema,
  mapping: z.optional(mappingSchema),
  retention: retentionOperationSchema,
  source: fieldNameSchema,
});

// Field value: literal string, single source reference, or composition (CONCAT of fields).
const fieldValueSchema = z.union([
  z.string().max(MAX_LITERAL_LENGTH),
  z.object({ source: fieldNameSchema }),
  z.object({
    composition: z.object({
      fields: z.array(fieldNameSchema).min(1).max(MAX_COMPOSITION_FIELDS),
      sep: z.string().max(MAX_LITERAL_LENGTH),
    }),
  }),
]);
export type FieldValueSchema = z.infer<typeof fieldValueSchema>;

// Schema for "when condition true set fields" (condition + field overrides). Used e.g. for pre-agg overrides.
export const setFieldsByConditionSchema = z.object({
  condition: streamlangConditionSchema,
  fields: z
    .record(fieldNameSchema, fieldValueSchema)
    .refine((value) => Object.keys(value).length > 0, {
      message: 'At least one field override is required',
    })
    .refine((value) => Object.keys(value).length <= MAX_SET_FIELDS_PER_RULE, {
      message: `At most ${MAX_SET_FIELDS_PER_RULE} field overrides are allowed`,
    }),
});
export type SetFieldsByCondition = z.infer<typeof setFieldsByConditionSchema>;

const setFieldsByConditionListSchema = z
  .array(setFieldsByConditionSchema)
  .max(MAX_SET_FIELDS_RULES);

// Definition-owned reasons stay separate so a rule can only report a reason it owns.
export const creationRejectionReasonSchema = z.enum([
  'user_not_local_namespace',
  'host_missing_host_id',
]);
export type CreationRejectionReason = z.infer<typeof creationRejectionReasonSchema>;

/** Conditional rules require both `requires` and `rejectionReason`; `{}` opts in unconditionally. */
const creatableFromSingleDocumentSchema = z.union([
  z.strictObject({
    requires: streamlangConditionSchema,
    rejectionReason: creationRejectionReasonSchema,
  }),
  z.strictObject({}),
]);
export type CreatableFromSingleDocument = z.infer<typeof creatableFromSingleDocumentSchema>;

export const extractionMaterialisationSchema = z.object({
  mode: z.literal('extraction'),
  // Value written to `entity.type` when the source documents carry none.
  entityTypeFallback: z.string().max(MAX_ENTITY_TYPE_FALLBACK_LENGTH).optional(),
  // Fields extracted into the store and their retention policy. Drives STATS, the merge EVAL,
  // the component template mappings and CRUD field validation.
  fields: z.array(fieldSchema).max(MAX_FIELDS),
  // Optional evaluated fields applied before pre-agg overrides and STATS for all entity types.
  fieldEvaluations: z.optional(fieldEvaluationsSchema),
  // Optional filter (Condition from @kbn/streamlang) applied in ESQL only, right after the
  // LOOKUP JOIN, to filter rows (e.g. keep already-stored entities or IDP-like events). No DSL equivalent.
  postAggFilter: z.optional(streamlangConditionSchema),
  // Optional: when conditions are true on source docs, set the given fields (EVAL after field evals, before STATS).
  whenConditionTrueSetFieldsPreAgg: z.optional(setFieldsByConditionListSchema),
  // Post-STATS EVAL in logs ESQL (recent.* vs plain). Single-doc paths re-apply entries after pre-agg for parity.
  whenConditionTrueSetFieldsAfterStats: z.optional(setFieldsByConditionListSchema),
  // Omission disables single-document creation for the entity type.
  creatableFromSingleDocument: z.optional(creatableFromSingleDocumentSchema),
});

export const noMaterialisationSchema = z.strictObject({
  mode: z.literal('none'),
});

export const materialisationSchema = z.discriminatedUnion('mode', [
  extractionMaterialisationSchema,
  noMaterialisationSchema,
]);

export type MaterialisationExtension = z.infer<typeof materialisationSchema>;
export type ExtractionMaterialisation = z.infer<typeof extractionMaterialisationSchema>;
export type MaterialisationMode = MaterialisationExtension['mode'];
export type EntityField = z.infer<typeof fieldSchema>; // entities fields
