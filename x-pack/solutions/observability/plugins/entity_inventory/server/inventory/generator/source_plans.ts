/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { BasicPrettyPrinter, Parser } from '@elastic/esql';
import type { InventoryMetric, InventorySource } from '@kbn/entity-store/common';
import { InventoryDefinitionError } from './columns';
import { validateEsqlFilter } from './filters';

/**
 * Canonical form of a filter expression, so `state=="idle"` and `state == "idle"` plan as one query
 * instead of two. Only a grouping key: the query keeps the author's own text. An expression that
 * does not print groups by its raw text, which can only split a group, never merge two.
 */
const canonicalFilter = (filter: string): string => {
  const { root, errors } = Parser.parse(`FROM x | WHERE ${filter}`);
  const [expression] = root.commands[1]?.args ?? [];
  if (errors.length > 0 || expression === undefined || Array.isArray(expression)) {
    return filter;
  }
  try {
    return BasicPrettyPrinter.expression(expression);
  } catch {
    return filter;
  }
};

/** A metric filter narrows its source's documents further, so the two conjoin. */
const conjoin = (sourceFilter?: string, metricFilter?: string): string | undefined => {
  if (sourceFilter === undefined) return metricFilter;
  if (metricFilter === undefined) return sourceFilter;
  return `(${sourceFilter}) AND (${metricFilter})`;
};

/**
 * Expands the authored sources into the sources the generator queries: one per distinct metric
 * `filter`, carrying that filter (conjoined with the source's own) and only the metrics that
 * declared it. Metrics without a filter stay together in one plan, and a source whose metrics
 * declare no filter is returned untouched.
 *
 * A plan is an ordinary source, so a definition using filtered metrics generates exactly the
 * queries the equivalent definition with one source per filter generates, in the same order:
 * declaration order of the sources, then first appearance of each filter within a source. That is
 * the point. Splitting measured 1.4x to 9.6x cheaper than one query with per-aggregate `WHERE`
 * filters above a few hundred thousand scanned documents, and never worse on latency because the
 * executor runs plans concurrently; see `entity_inventory_filtered_aggregation_findings.md`.
 *
 * Per-source and top-level attributes belong to every plan of their source, as they do when an
 * author writes the sources out by hand. For disjoint filters that costs nothing: the plans
 * partition the source's documents, so the attribute work is the same in total.
 */
export const planSources = (sources: InventorySource[]): InventorySource[] =>
  sources.flatMap((source) => {
    const metrics = source.metrics ?? [];
    if (!metrics.some(({ filter }) => filter !== undefined)) {
      return [source];
    }
    const plans = new Map<string, { filter?: string; metrics: InventoryMetric[] }>();
    for (const metric of metrics) {
      const { filter, ...planned } = metric;
      if (filter !== undefined) {
        const problem = validateEsqlFilter(filter, `filter of metric "${metric.name}"`);
        if (problem) {
          throw new InventoryDefinitionError(problem);
        }
      }
      const key = filter === undefined ? '' : canonicalFilter(filter);
      const plan = plans.get(key);
      if (plan) {
        plan.metrics.push(planned);
        continue;
      }
      plans.set(key, { filter, metrics: [planned] });
    }
    return [...plans.values()].map(({ filter, metrics: planned }) => {
      const effective = conjoin(source.filter, filter);
      return {
        ...source,
        ...(effective !== undefined ? { filter: effective } : {}),
        metrics: planned,
      };
    });
  });
