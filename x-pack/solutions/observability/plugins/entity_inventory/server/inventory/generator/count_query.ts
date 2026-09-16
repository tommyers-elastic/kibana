/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { EntityDefinition, InventorySource } from '@kbn/entity-store/common';
import { Parser } from '@elastic/esql';
import { backingIndexLikePatterns, quoteIdentifier, quoteString } from './esql_syntax';
import type { IdentityPlan } from './identity';
import { assertSafeIndexPattern, sourcePredicates, timeParams } from './source_query';
import type { GeneratedQuery, TimeRange } from './types';

export const COUNT_COLUMN = 'count';

const TIME_PREDICATE = '@timestamp >= ?from AND @timestamp < ?to';

/**
 * Exact distinct entity count across every source in one `FROM` query. Grouping state is not
 * capped (only output rows are), so this is exact at any scale, and it costs 15% to 30% of the list
 * query. Each source's own predicates apply to its own indices through `_index`, so the count
 * matches exactly the entities the per-source lists would show.
 *
 * ```
 * FROM a, b METADATA _index
 * | WHERE <time> AND <identity present>
 *     AND ((<a indices> AND <a predicates>) OR (<b indices> AND <b predicates>))
 * | STATS BY <identity fields>
 * | STATS count = COUNT(*)
 * ```
 */
export const buildCountQuery = (
  definition: EntityDefinition,
  identity: IdentityPlan,
  sources: InventorySource[],
  range: TimeRange
): GeneratedQuery => {
  if (sources.length === 0) {
    throw new Error(`no sources to count for "${definition.type}"`);
  }
  sources.forEach(({ index }) => assertSafeIndexPattern(index));
  const indices = [...new Set(sources.map(({ index }) => index))];
  const by = identity.fields.map(quoteIdentifier).join(', ');

  const perSource = sources.map((source) => {
    // Identity presence is common to every source; keep it out of the per-source branch.
    const predicates = sourcePredicates(source, identity).filter(
      (predicate) => predicate !== identity.presenceFilter
    );
    if (sources.length === 1) {
      return predicates;
    }
    const indexMatch = `(${backingIndexLikePatterns(source.index)
      .map((pattern) => `_index LIKE ${quoteString(pattern)}`)
      .join(' OR ')})`;
    return [indexMatch, ...predicates];
  });

  const sourceBranch =
    sources.length === 1
      ? perSource[0]
      : [`(${perSource.map((predicates) => `(${predicates.join(' AND ')})`).join('\n      OR ')})`];

  const lines = [
    'SET unmapped_fields="nullify";',
    `FROM ${indices.join(', ')}${sources.length > 1 ? ' METADATA _index' : ''}`,
    `| WHERE ${[TIME_PREDICATE, identity.presenceFilter, ...sourceBranch].join('\n    AND ')}`,
    `| STATS BY ${by}`,
    `| STATS ${quoteIdentifier(COUNT_COLUMN)} = COUNT(*)`,
  ];
  const esql = lines.join('\n');
  const { errors } = Parser.parse(esql);
  if (errors.length > 0) {
    throw new Error(`generated ES|QL does not parse: ${errors[0].message}\n${esql}`);
  }
  return { esql, params: timeParams(range) };
};
