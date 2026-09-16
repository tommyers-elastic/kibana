/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { EntityDefinition, InventoryMetric, InventorySource } from '@kbn/entity-store/common';
import { Parser } from '@elastic/esql';
import { ESQL_MAX_ROWS, LAST_SEEN_COLUMN, type InventoryEngine } from '../../../common';
import { InventoryDefinitionError, getInventory, sourceColumnNames } from './columns';
import { isSafeIndexPattern, quoteIdentifier } from './esql_syntax';
import { validateSourceFilter } from './filters';
import type { IdentityPlan } from './identity';
import type {
  GeneratedQuery,
  NamedParams,
  SourcePlan,
  SourceQueryOptions,
  TimeRange,
} from './types';

export const UNMAPPED_FIELDS_DIRECTIVE = 'SET unmapped_fields="nullify";';

const TIME_PREDICATE = '@timestamp >= ?from AND @timestamp < ?to';

export const timeParams = ({ from, to }: TimeRange): NamedParams => [{ from }, { to }];

/**
 * Metric aggregate per engine. `avg`/`min`/`max`/`sum` are window aggregates and return identical
 * values under both engines (`AGG(AGG_OVER_TIME(f))` is `TS`'s two-stage form of `AGG(f)`);
 * `count_distinct` and `last` are engine-neutral.
 */
export const metricExpression = (metric: InventoryMetric, engine: InventoryEngine): string => {
  const field = quoteIdentifier(metric.field);
  switch (metric.agg) {
    case 'count_distinct':
      return `COUNT_DISTINCT(${field})`;
    case 'last':
      return `LAST(${field}, @timestamp) WHERE ${field} IS NOT NULL`;
    case 'avg':
    case 'min':
    case 'max':
    case 'sum': {
      const agg = metric.agg.toUpperCase();
      return engine === 'TS' ? `${agg}(${agg}_OVER_TIME(${field}))` : `${agg}(${field})`;
    }
  }
};

/** An ES|QL double literal for a scale factor (`1e-9` is written `1.0E-9`). */
const numberLiteral = (value: number): string => {
  const text = String(value);
  if (!/[eE]/.test(text)) {
    return text.includes('.') ? text : `${text}.0`;
  }
  const [mantissa, exponent] = text.split(/[eE]/);
  return `${mantissa.includes('.') ? mantissa : `${mantissa}.0`}E${exponent}`;
};

/** `scale` multiplies the aggregated value (on the entity rows, not per document). */
const scaleAssignments = (source: InventorySource): string[] =>
  (source.metrics ?? [])
    .filter((metric) => metric.scale !== undefined && metric.scale !== 1)
    .map(
      (metric) =>
        `${quoteIdentifier(metric.name)} = ${quoteIdentifier(metric.name)} * ${numberLiteral(
          metric.scale as number
        )}`
    );

/** `LAST(f, @timestamp)` does not skip null rows in either engine, so every attribute filters them. */
const attributeExpression = (field: string): string => {
  const quoted = quoteIdentifier(field);
  return `LAST(${quoted}, @timestamp) WHERE ${quoted} IS NOT NULL`;
};

/**
 * A source that declares metrics lists the entities that reported at least one of them: explicit
 * in `WHERE` so `TS` (which only scans metric-carrying documents anyway) and `FROM` agree and
 * `FROM` gets the same pushdown. Only value metrics count as "reported": a `count_distinct` is
 * usually over a dimension present on every document (pod names, node names), which would make
 * the predicate true everywhere and turn the `FROM` count into a full scan (measured: 43M
 * documents instead of 5.9M at 6 h). Sources with only `count_distinct` metrics fall back to
 * those fields so presence is still required.
 */
export const metricPresenceFilter = (source: InventorySource): string | undefined => {
  const metrics = source.metrics ?? [];
  const valueMetrics = metrics.filter(({ agg }) => agg !== 'count_distinct');
  const fields = [
    ...new Set((valueMetrics.length > 0 ? valueMetrics : metrics).map(({ field }) => field)),
  ];
  if (fields.length === 0) {
    return undefined;
  }
  return `(${fields.map((field) => `${quoteIdentifier(field)} IS NOT NULL`).join(' OR ')})`;
};

/** The pre-aggregation predicates of a source, in order, excluding the time range. */
export const sourcePredicates = (source: InventorySource, identity: IdentityPlan): string[] => {
  const predicates: string[] = [];
  if (source.filter !== undefined) {
    const problem = validateSourceFilter(source.filter);
    if (problem) {
      throw new InventoryDefinitionError(problem);
    }
    predicates.push(`(${source.filter})`);
  }
  predicates.push(identity.presenceFilter);
  const presence = metricPresenceFilter(source);
  if (presence) {
    predicates.push(presence);
  }
  return predicates;
};

export const assertSafeIndexPattern = (index: string): void => {
  if (!isSafeIndexPattern(index)) {
    throw new InventoryDefinitionError(`source index pattern is not safe to query: "${index}"`);
  }
};

/** Throws when the generated text does not parse; a guard against quoting mistakes, not user input. */
const assertParses = (esql: string): void => {
  const { errors } = Parser.parse(esql);
  if (errors.length > 0) {
    throw new Error(`generated ES|QL does not parse: ${errors[0].message}\n${esql}`);
  }
};

/**
 * One list or detail query for one source:
 *
 * ```
 * SET unmapped_fields="nullify";
 * TS|FROM <index>
 * | WHERE <time> [AND (<filter>)] AND <identity present> [AND (<a metric present>)] [AND <id> == ?id_0]
 * | STATS <metrics>, <attributes as filtered LAST>, last_seen = MAX(@timestamp) BY <identity fields>
 * | EVAL entity.id = <compiler expression>
 * | KEEP <this source's columns>
 * | SORT ... | LIMIT ...
 * ```
 */
export const buildSourceQuery = (
  definition: EntityDefinition,
  identity: IdentityPlan,
  { source, engine }: SourcePlan,
  options: SourceQueryOptions
): GeneratedQuery => {
  const inventory = getInventory(definition);
  assertSafeIndexPattern(source.index);

  const params: NamedParams = timeParams(options.range);
  const predicates = [TIME_PREDICATE, ...sourcePredicates(source, identity)];
  if (options.identityValues) {
    Object.entries(options.identityValues).forEach(([field, value], index) => {
      if (!identity.fields.includes(field)) {
        throw new InventoryDefinitionError(
          `"${field}" is not an identity field of "${definition.type}"`
        );
      }
      const name = `id_${index}`;
      predicates.push(`${quoteIdentifier(field)} == ?${name}`);
      params.push({ [name]: value });
    });
  }

  const aggregates: string[] = [];
  for (const metric of source.metrics ?? []) {
    aggregates.push(`${quoteIdentifier(metric.name)} = ${metricExpression(metric, engine)}`);
  }
  for (const field of inventory.attributes ?? []) {
    aggregates.push(`${quoteIdentifier(field)} = ${attributeExpression(field)}`);
  }
  for (const attribute of source.attributes ?? []) {
    aggregates.push(`${quoteIdentifier(attribute.name)} = ${attributeExpression(attribute.field)}`);
  }
  aggregates.push(`${quoteIdentifier(LAST_SEEN_COLUMN)} = MAX(@timestamp)`);

  const columns = sourceColumnNames(definition, identity, source);
  const scaled = scaleAssignments(source);
  const lines = [
    UNMAPPED_FIELDS_DIRECTIVE,
    `${engine} ${source.index}`,
    `| WHERE ${predicates.join('\n    AND ')}`,
    `| STATS ${aggregates.join(',\n    ')}\n    BY ${identity.fields
      .map(quoteIdentifier)
      .join(', ')}`,
    ...(scaled.length > 0 ? [`| EVAL ${scaled.join(', ')}`] : []),
    `| EVAL ${identity.entityIdEvaluation}`,
    `| KEEP ${columns.map(quoteIdentifier).join(', ')}`,
  ];

  const sortColumn =
    options.pushDownSort && options.sort && columns.includes(options.sort.column)
      ? options.sort
      : { column: LAST_SEEN_COLUMN, direction: 'desc' as const };
  lines.push(
    `| SORT ${quoteIdentifier(sortColumn.column)} ${sortColumn.direction.toUpperCase()} NULLS LAST`
  );
  const limit = options.pushDownSort ? Math.min(options.limit, ESQL_MAX_ROWS) : ESQL_MAX_ROWS;
  lines.push(`| LIMIT ${limit}`);

  const esql = lines.join('\n');
  assertParses(esql);
  return { esql, params };
};
