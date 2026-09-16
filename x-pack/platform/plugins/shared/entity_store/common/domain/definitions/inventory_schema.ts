/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod/v4';
import { entityTypeNameSchema } from './identity_core_schema';

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
const MAX_ATTRIBUTES_PER_SOURCE = 64;
const MAX_VALUE_LABELS = 64;
const MAX_VALUE_LABEL_LENGTH = 256;
const MAX_UNIT_LENGTH = 32;

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
 * How a metric field is aggregated per entity over the window. `avg`, `min`, `max` and `sum` are
 * window aggregates and mean the same under both engines: the generator emits
 * `AGG(AGG_OVER_TIME(f))` under `TS` and `AGG(f)` under `FROM`, which return identical values.
 * `count` counts the documents carrying the field (log lines per service with `@timestamp`);
 * `count_distinct` counts distinct values of the field. `last` is the newest sample in the window
 * (`LAST(f, @timestamp)` with a null filter, identical under both engines), for "current value"
 * columns. `count` and `count_distinct` do not define an entity's existence in a source (only value
 * metrics do). Counter-rate aggregations are not modelled yet.
 */
export const inventoryMetricAggregationSchema = z.enum([
  'avg',
  'min',
  'max',
  'sum',
  'count',
  'count_distinct',
  'last',
]);
export type InventoryMetricAggregation = z.infer<typeof inventoryMetricAggregationSchema>;

/**
 * A named metric: one field aggregated one way per entity. Across sources the same `name` is the
 * same measurement in the same unit; `scale` multiplies the aggregated value so pipelines that
 * report in different units line up (ECS nanocores to cores: `scale: 1e-9`), and `unit` documents
 * the resulting unit (`cores`, `bytes`, `percent`) for display and for the consistency check.
 */
export const inventoryMetricSchema = z
  .strictObject({
    name: identifierSchema,
    field: literalFieldPathSchema,
    agg: inventoryMetricAggregationSchema,
    scale: z
      .number()
      .refine((value) => Number.isFinite(value) && value !== 0, {
        message: 'scale must be a finite, non-zero number',
      })
      .optional(),
    unit: z.string().min(1).max(MAX_UNIT_LENGTH).optional(),
  })
  .refine(
    (metric) =>
      !((metric.agg === 'count_distinct' || metric.agg === 'count') && metric.scale !== undefined),
    { message: 'scale does not apply to count or count_distinct', path: ['scale'] }
  );
export type InventoryMetric = z.infer<typeof inventoryMetricSchema>;

/**
 * Maps raw attribute values (stringified) to canonical display labels, e.g. the OTel numeric pod
 * phase `"2"` and the ECS keyword `"Running"` both to `"running"`. Applied by the query executor
 * on the aggregated rows, never in ES|QL. A raw value without an entry passes through unchanged.
 */
export const inventoryValueLabelsSchema = z
  .record(
    z.string().min(1).max(MAX_VALUE_LABEL_LENGTH),
    z.string().min(1).max(MAX_VALUE_LABEL_LENGTH)
  )
  .refine((labels) => Object.keys(labels).length <= MAX_VALUE_LABELS, {
    message: `at most ${MAX_VALUE_LABELS} value labels`,
  });
export type InventoryValueLabels = z.infer<typeof inventoryValueLabelsSchema>;

/**
 * A named attribute variant of one source: the newest value of `field` per entity, shown under
 * `name`. Per-source attributes exist for fields that do not alias across pipelines (the same
 * logical attribute has a different field and value space per pipeline); the top-level
 * `attributes` list covers fields that do alias. Across sources the same `name` is the same
 * attribute and the values merge by name, like metrics.
 */
export const inventorySourceAttributeSchema = z.strictObject({
  name: identifierSchema,
  field: literalFieldPathSchema,
  valueLabels: inventoryValueLabelsSchema.optional(),
});
export type InventorySourceAttribute = z.infer<typeof inventorySourceAttributeSchema>;

/**
 * One binding of the entity type to an index pattern. Metrics and per-source attributes are per
 * source because their fields do not alias across pipelines (units and value spaces differ);
 * across sources the same name means the same measurement or attribute reported by a different
 * pipeline. Names are output columns and must be unique within a source across both lists.
 *
 * A source that declares metrics lists the entities that reported at least one of them in the
 * window; a source without metrics lists every identity occurrence. A family that should define
 * existence on its own (e.g. `state_pod`) is therefore declared as its own metric-less source.
 */
export const inventorySourceSchema = z
  .strictObject({
    index: indexPatternSchema,
    filter: sourceFilterSchema.optional(),
    metrics: z.array(inventoryMetricSchema).max(MAX_METRICS_PER_SOURCE).optional(),
    attributes: z.array(inventorySourceAttributeSchema).max(MAX_ATTRIBUTES_PER_SOURCE).optional(),
  })
  .refine(
    (source) =>
      uniqueStrings([
        ...(source.metrics ?? []).map(({ name }) => name),
        ...(source.attributes ?? []).map(({ name }) => name),
      ]),
    { message: 'metric and attribute names must be unique within a source' }
  );
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
   * ECS names so the ECS<->OTel alias layer resolves them on both pipeline shapes. Fields that do
   * not alias are declared per source (`sources[].attributes`) under a shared name instead.
   */
  attributes: z
    .array(literalFieldPathSchema)
    .max(MAX_ATTRIBUTES)
    .refine(uniqueStrings, { message: 'attributes must be unique' })
    .optional(),
  /** Existence is identity occurrence in any declared source; metric-less entities list with null metrics. */
  sources: z.array(inventorySourceSchema).min(1).max(MAX_SOURCES),
};

/**
 * Output column names must be unambiguous across the whole extension: a per-source attribute name
 * may not be a metric name in another source, and may not repeat a top-level attribute or (where
 * known) an identity field, since every one of them becomes a column of the same row. Metrics
 * that share a name across sources are the same measurement: they must share `agg` and, where
 * declared, `unit` (use `scale` to bring a pipeline's field into that unit).
 */
const assertOutputColumnsUnambiguous = (
  inventory: { identity?: string[]; attributes?: string[]; sources: InventorySource[] },
  ctx: z.RefinementCtx
): void => {
  const reserved = new Set([...(inventory.identity ?? []), ...(inventory.attributes ?? [])]);
  const metricNames = new Set(
    inventory.sources.flatMap((source) => (source.metrics ?? []).map(({ name }) => name))
  );
  const firstMetricByName = new Map<string, { agg: string; unit?: string; sourceIndex: number }>();
  for (const [sourceIndex, source] of inventory.sources.entries()) {
    for (const [index, metric] of (source.metrics ?? []).entries()) {
      const first = firstMetricByName.get(metric.name);
      if (!first) {
        firstMetricByName.set(metric.name, { agg: metric.agg, unit: metric.unit, sourceIndex });
        continue;
      }
      if (first.agg !== metric.agg) {
        ctx.addIssue({
          code: 'custom',
          path: ['sources', sourceIndex, 'metrics', index, 'agg'],
          message: `metric "${metric.name}" is aggregated with "${first.agg}" in source ${first.sourceIndex} and "${metric.agg}" here; the same name means the same measurement`,
        });
      }
      if (first.unit !== undefined && metric.unit !== undefined && first.unit !== metric.unit) {
        ctx.addIssue({
          code: 'custom',
          path: ['sources', sourceIndex, 'metrics', index, 'unit'],
          message: `metric "${metric.name}" is in "${first.unit}" in source ${first.sourceIndex} and "${metric.unit}" here; use scale to normalise to one unit`,
        });
      }
    }
  }
  for (const [sourceIndex, source] of inventory.sources.entries()) {
    for (const [index, { name }] of (source.attributes ?? []).entries()) {
      if (reserved.has(name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['sources', sourceIndex, 'attributes', index, 'name'],
          message: `attribute "${name}" repeats an identity field or a top-level attribute`,
        });
      }
      if (metricNames.has(name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['sources', sourceIndex, 'attributes', index, 'name'],
          message: `"${name}" is used as an attribute in one source and as a metric in another`,
        });
      }
    }
  }
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
    assertOutputColumnsUnambiguous(inventory, ctx);
  });

export type InventoryExtension = z.infer<typeof inventoryExtensionSchema>;

/**
 * An inventory extension attached to a built-in (Security) type by another plugin through
 * `registerInventoryExtension`. It has no `identity`: the built-in core's `identityField` is the
 * identity, so entity ids stay `host:` / `user:` ids and the query generator groups by the fields
 * that ranking references. Attributes may not be identity fields of the built-in; that rule is
 * applied at registration, where the built-in definition is known.
 */
export const builtInInventoryExtensionSchema = z
  .strictObject(inventoryExtensionShape)
  .superRefine(assertOutputColumnsUnambiguous);

export type BuiltInInventoryExtension = z.infer<typeof builtInInventoryExtensionSchema>;

/**
 * The document that declares a built-in inventory extension, for code (`registerInventoryExtension`)
 * and the definitions API alike: `extends` names the built-in type, `inventory` is the extension.
 * No `type`, identity or materialisation: a document with `type` is a full definition. Whether
 * `extends` is actually a built-in is a registration rule (`assertRegistrableExtension`), so the
 * error can point at the definitions API.
 */
export const builtInInventoryExtensionDocumentSchema = z.strictObject({
  extends: entityTypeNameSchema,
  inventory: builtInInventoryExtensionSchema,
});

export type BuiltInInventoryExtensionDocument = z.infer<
  typeof builtInInventoryExtensionDocumentSchema
>;

/** Discriminates an API body / registration input: `extends` means extension, `type` means definition. */
export const isBuiltInInventoryExtensionDocument = (
  document: object
): document is BuiltInInventoryExtensionDocument => 'extends' in document;
