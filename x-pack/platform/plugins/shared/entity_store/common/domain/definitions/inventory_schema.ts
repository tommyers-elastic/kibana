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
 * views are ES|QL over the declared `sources`, grouped by the fields of the core `identityField`
 * (the single identity declaration of every type; see `assertInventoryIdentityIsServable` in
 * `entity_schema.ts` for the subset the generator serves). Nothing here is read by the extraction
 * engine; it is consumed by the inventory query generator.
 *
 * Authors declare *what* they need (attributes, metrics per source), never *how* it is
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
const MAX_ATTRIBUTES = 64;
const MAX_SOURCES = 16;
/**
 * A list runs one concurrent ES|QL query per query plan, and filtered metrics expand a source into
 * several plans, so the source count alone no longer bounds them. Budget the expansion at twice the
 * source cap: enough that a type can split two or three metrics several ways per pipeline, and
 * still a bound a reviewer can reason about.
 */
const MAX_QUERY_PLANS = 32;
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
 * Opaque ES|QL boolean expression narrowing a source, or a single metric of it, to the documents
 * that carry what is being declared (e.g. `metricset.name == "pod"`, `state == "idle"`). The one
 * piece of ES|QL an author writes: it encodes knowledge of the data stream that cannot be
 * inferred, and it is the biggest performance lever on list queries. Validated for length only
 * here; the query generator owns its safe placement and rejects command separators and comments.
 */
const esqlFilterSchema = z.string().min(1).max(MAX_FILTER_LENGTH);

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
 * metrics do).
 *
 * The `*_rate` aggregations read a monotonic counter (`system.network.io`,
 * `system.network.in.bytes`). `RATE` gives the per-second rate of increase of each of the
 * counter's own time series over the window (one per dimension tuple, such as a network
 * interface), and the prefix says how those series combine into the entity's value: `sum_rate` is
 * the entity's total throughput, `max_rate` its busiest series, `avg_rate` and `min_rate` the mean
 * and the quietest. Counter rates exist only under the `TS` engine: a source whose concrete
 * indices are not all `index.mode: time_series` cannot express one, so the executor leaves the
 * metric out of that source's query and reports it in the response's `unsupportedMetrics`
 * instead of returning a number that is not a rate.
 */
export const inventoryMetricAggregationSchema = z.enum([
  'avg',
  'min',
  'max',
  'sum',
  'count',
  'count_distinct',
  'last',
  'avg_rate',
  'min_rate',
  'max_rate',
  'sum_rate',
]);
export type InventoryMetricAggregation = z.infer<typeof inventoryMetricAggregationSchema>;

export type InventoryRateAggregation = Extract<InventoryMetricAggregation, `${string}_rate`>;

/** Whether `agg` is a counter rate (`OUTER(RATE(field))`), which only the `TS` engine can compute. */
export const isInventoryRateAggregation = (
  agg: InventoryMetricAggregation
): agg is InventoryRateAggregation => agg.endsWith('_rate');

/**
 * A named metric: one field aggregated one way per entity. Across sources the same `name` is the
 * same measurement in the same unit; `scale` multiplies the aggregated value and `offset` is then
 * added, so pipelines that report in different units or conventions line up (ECS nanocores to
 * cores: `scale: 1e-9`; OTel idle-cpu fraction to busy fraction: `scale: -1, offset: 1`), and
 * `unit` documents the resulting unit (`cores`, `bytes`, `ratio`, `bytes/s`) for display and for
 * the consistency check. A rate aggregation takes `scale` (bytes per second to bits per second:
 * `scale: 8`) but not `offset`: a counter rate has a true zero, and shifting it yields something
 * that is no longer a rate.
 *
 * `filter` narrows the metric to a subset of its source's documents, for pipelines that carry a
 * dimension as an attribute of one field where others encode it in the field name (OTel
 * `system.cpu.utilization` has a `state` dimension and network metrics a `direction`; the ECS
 * integrations have `system.cpu.idle.pct` and `system.network.in.bytes`). The generator plans one
 * query per distinct filter, so filtered metrics on one source cost exactly what the same metrics
 * split across one source per filter cost: this is authoring sugar, not a query optimisation, and
 * it exists so the filter sits next to the metric it qualifies.
 */
export const inventoryMetricSchema = z
  .strictObject({
    name: identifierSchema,
    field: literalFieldPathSchema,
    agg: inventoryMetricAggregationSchema,
    filter: esqlFilterSchema.optional(),
    scale: z
      .number()
      .refine((value) => Number.isFinite(value) && value !== 0, {
        message: 'scale must be a finite, non-zero number',
      })
      .optional(),
    offset: z
      .number()
      .refine((value) => Number.isFinite(value), { message: 'offset must be a finite number' })
      .optional(),
    unit: z.string().min(1).max(MAX_UNIT_LENGTH).optional(),
  })
  .refine(
    (metric) =>
      !(
        (metric.agg === 'count_distinct' || metric.agg === 'count') &&
        (metric.scale !== undefined || metric.offset !== undefined)
      ),
    { message: 'scale and offset do not apply to count or count_distinct', path: ['scale'] }
  )
  .refine((metric) => !(isInventoryRateAggregation(metric.agg) && metric.offset !== undefined), {
    message:
      'offset does not apply to rate aggregations; a counter rate has a true zero (scale does)',
    path: ['offset'],
  });
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
    filter: esqlFilterSchema.optional(),
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
 * The inventory extension never describes identity: the core `identityField` does, for authored
 * definitions and built-in types alike. The same shape serves both the authored extension
 * (`inventoryExtensionSchema`) and the extension another plugin or the API attaches to a built-in
 * type (`builtInInventoryExtensionSchema`).
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
 * may not be a metric name in another source and may not repeat a top-level attribute, since every
 * one of them becomes a column of the same row. Metrics that share a name across sources are the
 * same measurement: they must share `agg` and, where declared, `unit` (use `scale` to bring a
 * pipeline's field into that unit). Clashes with the identity fields are a definition-level rule
 * (`assertInventoryIdentityIsServable`), where `identityField` is known.
 */
const assertOutputColumnsUnambiguous = (
  inventory: { attributes?: string[]; sources: InventorySource[] },
  ctx: z.RefinementCtx
): void => {
  const topLevelAttributes = new Set(inventory.attributes ?? []);
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
      if (topLevelAttributes.has(name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['sources', sourceIndex, 'attributes', index, 'name'],
          message: `attribute "${name}" repeats a top-level attribute`,
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

/**
 * Queries a list runs for one source: one per distinct metric `filter`, since each is planned as
 * its own `WHERE`. Metrics without a filter share one query, and a source with no metrics is one
 * query. Grouping here is textual, so it is an upper bound on what the generator plans (which
 * groups on the canonical form of the expression).
 */
const queryPlanCount = ({ metrics }: InventorySource): number =>
  metrics && metrics.length > 0 ? new Set(metrics.map(({ filter }) => filter ?? '')).size : 1;

const assertQueryPlanBudget = (
  inventory: { sources: InventorySource[] },
  ctx: z.RefinementCtx
): void => {
  const plans = inventory.sources.reduce((total, source) => total + queryPlanCount(source), 0);
  if (plans > MAX_QUERY_PLANS) {
    ctx.addIssue({
      code: 'custom',
      path: ['sources'],
      message: `${inventory.sources.length} sources expand to ${plans} queries (one per distinct metric filter); at most ${MAX_QUERY_PLANS} are allowed`,
    });
  }
};

/**
 * The inventory extension of an authored definition. Identity is not part of it: the definition's
 * `identityField` is the single identity declaration, validated against what the query generator
 * can serve in `entity_schema.ts`.
 */
export const inventoryExtensionSchema = z
  .strictObject(inventoryExtensionShape)
  .superRefine(assertOutputColumnsUnambiguous)
  .superRefine(assertQueryPlanBudget);

export type InventoryExtension = z.infer<typeof inventoryExtensionSchema>;

/**
 * An inventory extension attached to a built-in (Security) type by another plugin through
 * `registerInventoryExtension` or the definitions API. Same shape as the authored extension: the
 * built-in core's `identityField` is the identity, so entity ids stay `host:` / `user:` ids and
 * the query generator groups by the fields that ranking references. Attributes may not be
 * identity fields of the built-in; that rule is applied at registration, where the built-in
 * definition is known.
 */
export const builtInInventoryExtensionSchema = inventoryExtensionSchema;

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
