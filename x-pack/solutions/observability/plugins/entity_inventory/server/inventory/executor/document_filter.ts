/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';
import type { InventoryDocumentFilterWarning } from '../../../common';

type Predicate =
  | { kind: 'unknown' }
  | { kind: 'field'; field: string }
  | { kind: 'group'; minimum: number; children: Predicate[] };

const UNKNOWN: Predicate = { kind: 'unknown' };
const asArray = (queries?: QueryDslQueryContainer | QueryDslQueryContainer[]) =>
  queries === undefined ? [] : Array.isArray(queries) ? queries : [queries];

const fieldPredicate = (field: string): Predicate =>
  field.startsWith('_') || /[*?]/.test(field) ? UNKNOWN : { kind: 'field', field };

interface DocumentFilterAnalysis {
  fields: string[];
  warningFor: (
    index: string,
    eligibleIndices: Map<string, Set<string>>,
    columns: string[]
  ) => SourceDocumentFilterWarning[];
}

export interface SourceDocumentFilterWarning {
  warning: InventoryDocumentFilterWarning;
  coverageKey: string;
}

/** Combines equivalent exclusions while preserving all affected source patterns and columns. */
export const groupDocumentFilterWarnings = (
  warnings: SourceDocumentFilterWarning[]
): InventoryDocumentFilterWarning[] => {
  const groups = new Map<string, InventoryDocumentFilterWarning>();
  for (const { warning, coverageKey } of warnings) {
    const existing = groups.get(coverageKey);
    groups.set(
      coverageKey,
      existing
        ? {
            ...existing,
            sourcePatterns: [...new Set([...existing.sourcePatterns, ...warning.sourcePatterns])],
            columns: [...new Set([...existing.columns, ...warning.columns])],
          }
        : { ...warning }
    );
  }
  return [...groups.values()];
};

/** Proves mapping-based exclusions for supported positive clauses without interpreting opaque DSL. */
export const analyzeDocumentFilter = (query?: QueryDslQueryContainer): DocumentFilterAnalysis => {
  let remaining = 256;
  const parse = (clause?: QueryDslQueryContainer, depth = 0): Predicate => {
    if (!clause || typeof clause !== 'object' || depth > 16 || --remaining < 0) return UNKNOWN;
    if (Object.keys(clause).length !== 1) return UNKNOWN;
    if (clause.bool && typeof clause.bool === 'object') {
      const { must, filter, should, minimum_should_match: minimumShouldMatch } = clause.bool;
      if (asArray(must).length + asArray(filter).length + asArray(should).length > remaining)
        return UNKNOWN;
      const required = [...asArray(must), ...asArray(filter)].map((child) =>
        parse(child, depth + 1)
      );
      const alternatives = asArray(should);
      // Negative/percentage/conditional minimum_should_match forms remain opaque.
      const minimum =
        minimumShouldMatch === undefined
          ? required.length === 0
            ? 1
            : 0
          : /^\d+$/.test(String(minimumShouldMatch))
          ? Number(minimumShouldMatch)
          : undefined;
      if (alternatives.length > 0 && minimum !== undefined && minimum > 0) {
        required.push({
          kind: 'group',
          minimum: Math.min(minimum, alternatives.length),
          children: alternatives.map((child) => parse(child, depth + 1)),
        });
      }
      // must_not cannot make an unmapped positive clause exclude documents; leave it opaque.
      return { kind: 'group', minimum: required.length, children: required };
    }
    if (typeof clause.exists?.field === 'string') return fieldPredicate(clause.exists.field);
    const leaf =
      clause.term ??
      clause.terms ??
      clause.range ??
      clause.prefix ??
      clause.wildcard ??
      clause.regexp;
    if (leaf && typeof leaf === 'object') {
      const fields = Object.keys(leaf).filter((field) => field !== 'boost' && field !== '_name');
      return fields.length === 1 ? fieldPredicate(fields[0]) : UNKNOWN;
    }
    const match = clause.match ?? clause.match_phrase;
    if (match && typeof match === 'object') {
      const entries = Object.entries(match);
      if (entries.length === 1) {
        const [field, options] = entries[0];
        if (typeof options === 'object' && options !== null && options.zero_terms_query === 'all')
          return UNKNOWN;
        return fieldPredicate(field);
      }
    }
    return UNKNOWN;
  };
  const predicate = parse(query);
  const fields = new Set<string>();
  const collect = (node: Predicate): void => {
    if (node.kind === 'field') fields.add(node.field);
    if (node.kind === 'group') node.children.forEach(collect);
  };
  collect(predicate);

  const excludedBy = (node: Predicate, mapped: Set<string>): string[] => {
    if (node.kind === 'field') return mapped.has(node.field) ? [] : [node.field];
    if (node.kind !== 'group') return [];
    const excluded = node.children.map((child) => excludedBy(child, mapped));
    const possible = excluded.filter((reasons) => reasons.length === 0).length;
    return possible < node.minimum ? [...new Set(excluded.flat())] : [];
  };

  return {
    fields: [...fields],
    warningFor: (
      index: string,
      eligibleIndices: Map<string, Set<string>>,
      columns: string[]
    ): SourceDocumentFilterWarning[] => {
      const exclusions = [...eligibleIndices]
        .sort(([left], [right]) => left.localeCompare(right))
        .flatMap(([name, mapped]) => {
          const reasons = excludedBy(predicate, mapped);
          return reasons.length > 0 ? [{ name, reasons: reasons.sort() }] : [];
        });
      if (exclusions.length === 0) return [];
      return [
        {
          coverageKey: JSON.stringify([[...eligibleIndices.keys()].sort(), exclusions]),
          warning: {
            sourcePatterns: [index],
            code:
              exclusions.length === eligibleIndices.size ? 'source_excluded' : 'indices_excluded',
            fields: [...new Set(exclusions.flatMap(({ reasons }) => reasons))],
            excludedIndices: exclusions.map(({ name }) => name),
            eligibleIndexCount: eligibleIndices.size,
            columns: [...new Set(columns)],
          },
        },
      ];
    },
  };
};
