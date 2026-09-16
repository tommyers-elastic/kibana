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
 * Authors declare *what* they need (identity, attributes, metrics per source), never *how* it is
 * fetched. Engine selection (`TS` vs `FROM`), whether an attribute becomes a `BY` key or a
 * `LAST(...)` aggregate, null handling and `*_OVER_TIME` wrapping are query generator concerns.
 * Time windows and sort order are client concerns. Metadata lookup/write indices, edges and
 * derived metadata are deferred (see the "Deferred" section of the entity inventory context
 * document).
 *
 * Every string and array is bounded because this shape will be accepted over HTTP.
 */

const MAX_FIELD_PATH_LENGTH = 512;
const MAX_LABEL_LENGTH = 256;
const MAX_INDEX_PATTERN_LENGTH = 256;
const MAX_FILTER_LENGTH = 2000;
const MAX_IDENTIFIER_LENGTH = 64;
const MAX_IDENTITY_FIELDS = 8;
const MAX_ATTRIBUTES = 64;
const MAX_SOURCES = 16;
const MAX_METRICS_PER_SOURCE = 64;

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

/** Metric names become ES|QL column names; keep them simple identifiers. */
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/;

const identifierSchema = z.string().min(1).max(MAX_IDENTIFIER_LENGTH).regex(IDENTIFIER_PATTERN, {
  message:
    'must be a lowercase identifier (letters, digits and underscores, starting with a letter)',
});

/**
 * Opaque ES|QL boolean expression narrowing a source to the documents of this type (e.g.
 * `metricset.name == "pod"`). The one piece of ES|QL an author writes: it encodes knowledge of the
 * data stream that cannot be inferred, and it is the biggest performance lever on list queries.
 * Validated for length only in this stage; the query generator owns its safe placement.
 */
const sourceFilterSchema = z.string().min(1).max(MAX_FILTER_LENGTH);

const indexPatternSchema = z.string().min(1).max(MAX_INDEX_PATTERN_LENGTH);

const uniqueStrings = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;

/**
 * How a metric field is aggregated per entity over the window. The query generator emits the
 * engine-correct form (e.g. `AVG(LAST_OVER_TIME(f))` under `TS`, `AVG(f)` under `FROM`).
 * Counter-rate aggregations are not modelled yet.
 */
export const inventoryMetricAggregationSchema = z.enum([
  'avg',
  'min',
  'max',
  'sum',
  'count_distinct',
]);
export type InventoryMetricAggregation = z.infer<typeof inventoryMetricAggregationSchema>;

/** A named metric: one field aggregated one way per entity. */
export const inventoryMetricSchema = z.strictObject({
  name: identifierSchema,
  field: literalFieldPathSchema,
  agg: inventoryMetricAggregationSchema,
});
export type InventoryMetric = z.infer<typeof inventoryMetricSchema>;

/**
 * One binding of the entity type to an index pattern. Metrics are per source because metric
 * fields do not alias across pipelines (units differ); across sources the same metric name means
 * the same measurement reported by a different pipeline. Metric names must be unique within a source.
 */
export const inventorySourceSchema = z
  .strictObject({
    index: indexPatternSchema,
    filter: sourceFilterSchema.optional(),
    metrics: z.array(inventoryMetricSchema).max(MAX_METRICS_PER_SOURCE).optional(),
  })
  .refine((source) => uniqueStrings((source.metrics ?? []).map(({ name }) => name)), {
    message: 'metric names must be unique within a source',
  });
export type InventorySource = z.infer<typeof inventorySourceSchema>;

/**
 * The parts of an inventory extension that do not describe identity. Shared by the authored
 * extension (`inventoryExtensionSchema`, which adds `identity`) and the extension that another
 * plugin attaches to a built-in type (`builtInInventoryExtensionSchema`).
 */
const inventoryExtensionShape = {
  /** Human readable type name for the UI. */
  label: z.string().min(1).max(MAX_LABEL_LENGTH).optional(),
  /**
   * Literal field paths shown per entity, resolved to the newest observed value across all
   * sources that carry them. Structural fields (names, namespaces, nodes) should use canonical
   * ECS names so the ECS<->OTel alias layer resolves them on both pipeline shapes.
   */
  attributes: z
    .array(literalFieldPathSchema)
    .max(MAX_ATTRIBUTES)
    .refine(uniqueStrings, { message: 'attributes must be unique' })
    .optional(),
  /** Existence is identity occurrence in any declared source; metric-less entities list with null metrics. */
  sources: z.array(inventorySourceSchema).min(1).max(MAX_SOURCES),
};

export const inventoryExtensionSchema = z
  .strictObject({
    ...inventoryExtensionShape,
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
  })
  .superRefine((inventory, ctx) => {
    const identity = new Set(inventory.identity);
    for (const [index, field] of (inventory.attributes ?? []).entries()) {
      if (identity.has(field)) {
        ctx.addIssue({
          code: 'custom',
          path: ['attributes', index],
          message: `attribute "${field}" is already an identity field`,
        });
      }
    }
  });

export type InventoryExtension = z.infer<typeof inventoryExtensionSchema>;

/**
 * An inventory extension attached to a built-in (Security) type by another plugin through
 * `registerInventoryExtension`. It has no `identity`: the built-in core's `identityField` is the
 * identity, so entity ids stay `host:` / `user:` ids and the query generator groups by the fields
 * that ranking references. Attributes may not be identity fields of the built-in; that rule is
 * applied at registration, where the built-in definition is known.
 */
export const builtInInventoryExtensionSchema = z.strictObject(inventoryExtensionShape);

export type BuiltInInventoryExtension = z.infer<typeof builtInInventoryExtensionSchema>;
