/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod/v4';

/**
 * Inventory (Observability) extension of an entity definition.
 *
 * A definition carrying this extension is served live from telemetry: lists, counts and detail
 * views are ES|QL over the declared `sources`, grouped by the literal `identity` tuple. Nothing
 * here is read by the extraction engine; it is consumed by the inventory query generator.
 *
 * Every string and array is bounded because this shape will be accepted over HTTP.
 */

const MAX_FIELD_PATH_LENGTH = 512;
const MAX_LABEL_LENGTH = 256;
const MAX_INDEX_PATTERN_LENGTH = 256;
const MAX_ESQL_EXPRESSION_LENGTH = 2000;
const MAX_IDENTIFIER_LENGTH = 64;
const MAX_IDENTITY_FIELDS = 8;
const MAX_CARRY_FIELDS = 16;
const MAX_SOURCES = 16;
const MAX_METRICS_PER_SOURCE = 64;
const MAX_CAPTURES_PER_SOURCE = 64;
const MAX_LOOKUPS = 8;
const MAX_LOOKUP_KEY_FIELDS = 8;

/**
 * A literal, mapped field path: dot-separated segments of letters, digits, `_`, `@` and `-`.
 * Rejects anything that could be an expression (`(`), a wildcard (`*`), quoting or whitespace,
 * because identity fields are grouped and filtered on directly and must push down to the index.
 */
export const LITERAL_FIELD_PATH_PATTERN = /^[A-Za-z0-9_@-]+(?:\.[A-Za-z0-9_@-]+)*$/;

export const isLiteralFieldPath = (value: string): boolean =>
  value.length > 0 &&
  value.length <= MAX_FIELD_PATH_LENGTH &&
  LITERAL_FIELD_PATH_PATTERN.test(value);

export const literalFieldPathSchema = z
  .string()
  .min(1)
  .max(MAX_FIELD_PATH_LENGTH)
  .regex(LITERAL_FIELD_PATH_PATTERN, {
    message: 'must be a literal field path (no expressions, wildcards, quoting or whitespace)',
  });

/** `{number}{s|m|h|d}`, matching the plugin's `parseDurationToMs`. */
const DURATION_PATTERN = /^[1-9]\d*[smhd]$/;

export const inventoryDurationSchema = z.string().regex(DURATION_PATTERN, {
  message: 'must be a duration of the form {number}{s|m|h|d}, e.g. 15m',
});

/** Names of metrics and captures become ES|QL column names; keep them simple identifiers. */
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/;

const identifierSchema = z.string().min(1).max(MAX_IDENTIFIER_LENGTH).regex(IDENTIFIER_PATTERN, {
  message:
    'must be a lowercase identifier (letters, digits and underscores, starting with a letter)',
});

/**
 * Opaque ES|QL fragment (an aggregate expression or a boolean filter). Validated for length only
 * in this stage; the query generator is responsible for placing it safely inside a query.
 */
const esqlExpressionSchema = z.string().min(1).max(MAX_ESQL_EXPRESSION_LENGTH);

const indexPatternSchema = z.string().min(1).max(MAX_INDEX_PATTERN_LENGTH);

const uniqueStrings = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;

/**
 * Which ES|QL source command the metrics of a source run under. `TS` is only valid on
 * time-series data streams; `FROM` works everywhere. Captures always run as a companion `FROM`
 * query regardless of this value, because keyword aggregates return null under `TS` when the
 * scan spans mixed metric families.
 */
export const inventorySourceEngineSchema = z.enum(['TS', 'FROM']);
export type InventorySourceEngine = z.infer<typeof inventorySourceEngineSchema>;

/** A named aggregate evaluated once per entity over the source's documents in the window. */
export const inventoryMetricSchema = z.strictObject({
  name: identifierSchema,
  esql: esqlExpressionSchema,
});
export type InventoryMetric = z.infer<typeof inventoryMetricSchema>;

/**
 * A named attribute aggregate (e.g. `LAST(k8s.pod.phase, @timestamp)`) with an optional document
 * family filter. Captures serve mutable or family-scoped attributes that cannot be `carry` fields.
 */
export const inventoryCaptureSchema = z.strictObject({
  name: identifierSchema,
  esql: esqlExpressionSchema,
  filter: esqlExpressionSchema.optional(),
});
export type InventoryCapture = z.infer<typeof inventoryCaptureSchema>;

/**
 * One binding of the entity type to an index pattern. `filter` is the per-source discriminator
 * (e.g. `metricset.name == "pod"`) and is the biggest performance lever on list queries. Metric
 * and capture names must be unique within a source; across sources the same name means the same
 * measurement reported by a different pipeline.
 */
export const inventorySourceSchema = z
  .strictObject({
    index: indexPatternSchema,
    engine: inventorySourceEngineSchema,
    filter: esqlExpressionSchema.optional(),
    metrics: z.array(inventoryMetricSchema).max(MAX_METRICS_PER_SOURCE).optional(),
    captures: z.array(inventoryCaptureSchema).max(MAX_CAPTURES_PER_SOURCE).optional(),
  })
  .refine(
    (source) =>
      uniqueStrings([
        ...(source.metrics ?? []).map(({ name }) => name),
        ...(source.captures ?? []).map(({ name }) => name),
      ]),
    { message: 'metric and capture names must be unique within a source' }
  );
export type InventorySource = z.infer<typeof inventorySourceSchema>;

/** Declared now, consumed by a later stage: a lookup-mode index joined onto list rows by key. */
export const inventoryLookupSchema = z.strictObject({
  index: indexPatternSchema,
  on: z.array(literalFieldPathSchema).min(1).max(MAX_LOOKUP_KEY_FIELDS),
  rename: z.record(literalFieldPathSchema, literalFieldPathSchema).optional(),
});
export type InventoryLookup = z.infer<typeof inventoryLookupSchema>;

/** Declared now, consumed by a later stage: where user-supplied metadata for this type is written. */
export const inventoryMetadataWriteSchema = z.strictObject({
  index: indexPatternSchema,
  keyFields: z.array(literalFieldPathSchema).min(1).max(MAX_LOOKUP_KEY_FIELDS),
});
export type InventoryMetadataWrite = z.infer<typeof inventoryMetadataWriteSchema>;

/** Default list ordering; `field` is a metric, capture, carry field or a generated column such as `last_seen`. */
export const inventorySortSchema = z.strictObject({
  field: literalFieldPathSchema,
  direction: z.enum(['asc', 'desc']),
  nulls: z.enum(['first', 'last']).optional(),
});
export type InventorySort = z.infer<typeof inventorySortSchema>;

export const inventoryExtensionSchema = z
  .strictObject({
    /** Human readable type name for the UI. */
    label: z.string().min(1).max(MAX_LABEL_LENGTH).optional(),
    /**
     * Ordered tuple of literal field paths that identifies an entity. The core `identityField` is
     * derived from this list (see `identityTupleToIdentityField`); the list is kept here because
     * the query generator groups `BY` these fields and needs them as a list, not a composition.
     */
    identity: z
      .array(literalFieldPathSchema)
      .min(1)
      .max(MAX_IDENTITY_FIELDS)
      .refine(uniqueStrings, { message: 'identity fields must be unique' }),
    /**
     * Display fields added as extra `BY` keys next to the identity. A carry field must be 1:1 with
     * the identity AND present on every scanned document, otherwise it splits the entity into
     * per-family rows. Mutable or family-scoped attributes belong in `captures` instead.
     */
    carry: z.array(literalFieldPathSchema).max(MAX_CARRY_FIELDS).optional(),
    /**
     * Liveness horizon for lists and counts (a few multiples of the type's collection cadence).
     * Detail views may use longer windows.
     */
    inventoryWindow: inventoryDurationSchema.optional(),
    defaultSort: inventorySortSchema.optional(),
    /** Existence is identity occurrence in any declared source; metric-less entities list with null metrics. */
    sources: z.array(inventorySourceSchema).min(1).max(MAX_SOURCES),
    lookups: z.array(inventoryLookupSchema).max(MAX_LOOKUPS).optional(),
    metadataWrite: inventoryMetadataWriteSchema.optional(),
  })
  .superRefine((inventory, ctx) => {
    const identity = new Set(inventory.identity);
    for (const [index, field] of (inventory.carry ?? []).entries()) {
      if (identity.has(field)) {
        ctx.addIssue({
          code: 'custom',
          path: ['carry', index],
          message: `carry field "${field}" is already an identity field`,
        });
      }
    }
  });

export type InventoryExtension = z.infer<typeof inventoryExtensionSchema>;
