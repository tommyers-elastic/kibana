/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';
import { fromKueryExpression, toElasticsearchQuery } from '@kbn/es-query';
import { analyzeDocumentFilter, groupDocumentFilterWarnings } from './document_filter';

const warn = (query: QueryDslQueryContainer, fields = ['service.environment']) =>
  groupDocumentFilterWarnings(
    analyzeDocumentFilter(query).warningFor('traces-*', new Map([['traces-1', new Set(fields)]]), [
      'latency',
    ])
  );

const environment = { term: { environment: 'prod' } };
const serviceEnvironment = { term: { 'service.environment': 'prod' } };

describe('document filter mapping warnings', () => {
  it('reports whole-source and partial-index exclusions with affected columns', () => {
    const analysis = analyzeDocumentFilter(environment);
    expect(analysis.fields).toEqual(['environment']);
    expect(warn(environment)).toEqual([
      {
        sourcePatterns: ['traces-*'],
        code: 'source_excluded',
        fields: ['environment'],
        excludedIndices: ['traces-1'],
        eligibleIndexCount: 1,
        columns: ['latency'],
      },
    ]);
    expect(
      groupDocumentFilterWarnings(
        analysis.warningFor(
          'traces-*',
          new Map([
            ['old', new Set<string>()],
            ['new', new Set(['environment'])],
          ]),
          []
        )
      )
    ).toEqual([
      expect.objectContaining({
        code: 'indices_excluded',
        excludedIndices: ['old'],
        eligibleIndexCount: 2,
      }),
    ]);
    expect(warn(environment, ['environment'])).toEqual([]);
  });

  it.each([
    ['AND', { bool: { filter: [environment, serviceEnvironment] } }, true],
    ['OR', { bool: { should: [environment, serviceEnvironment] } }, false],
    [
      'required OR branches',
      { bool: { should: [environment, serviceEnvironment], minimum_should_match: 2 } },
      true,
    ],
    ['optional should', { bool: { filter: serviceEnvironment, should: environment } }, false],
    [
      'explicit required should',
      { bool: { filter: serviceEnvironment, should: environment, minimum_should_match: '1' } },
      true,
    ],
    ['negation', { bool: { must_not: environment } }, false],
    [
      'opaque OR branch',
      { bool: { should: [environment, { query_string: { query: 'prod' } }] } },
      false,
    ],
    [
      'percentage threshold',
      { bool: { should: [environment], minimum_should_match: '50%' } },
      false,
    ],
    [
      'all unmapped OR branches',
      { bool: { should: [environment, { exists: { field: 'other' } }] } },
      true,
    ],
  ] as Array<[string, QueryDslQueryContainer, boolean]>)('%s', (_, query, excluded) => {
    expect(warn(query).length > 0).toBe(excluded);
  });

  it.each(['environment: prod', 'environment: prod AND service.environment: prod'])(
    'understands required fields in UI KQL: %s',
    (kql) => {
      expect(warn(toElasticsearchQuery(fromKueryExpression(kql)))).toHaveLength(1);
    }
  );

  it.each(['environment: prod OR service.environment: prod', 'NOT environment: prod'])(
    'does not mislabel alternative or negated UI KQL: %s',
    (kql) => {
      expect(warn(toElasticsearchQuery(fromKueryExpression(kql)))).toEqual([]);
    }
  );

  it('leaves unknown clauses, metadata, wildcard fields and zero-terms matches opaque', () => {
    expect(warn({ script: { script: 'true' } })).toEqual([]);
    expect(warn({ term: { _index: 'traces-1' } })).toEqual([]);
    expect(warn({ exists: { field: 'environment*' } })).toEqual([]);
    expect(warn({ match: { environment: { query: '', zero_terms_query: 'all' } } })).toEqual([]);
    expect(analyzeDocumentFilter().warningFor('a', new Map(), [])).toEqual([]);
  });

  it('bounds analysis of deeply nested and very wide queries', () => {
    let nested: QueryDslQueryContainer = environment;
    for (let depth = 0; depth < 30; depth++) nested = { bool: { filter: nested } };
    expect(warn(nested)).toEqual([]);
    expect(warn({ bool: { should: Array.from({ length: 300 }, () => environment) } })).toEqual([]);
  });

  it('groups identical coverage across patterns, unions columns, and preserves partial overlaps', () => {
    const analysis = analyzeDocumentFilter(environment);
    const coverage = new Map([
      ['one', new Set<string>()],
      ['two', new Set(['environment'])],
    ]);
    const warnings = groupDocumentFilterWarnings([
      ...analysis.warningFor('metrics-*', coverage, ['cpu']),
      ...analysis.warningFor('metrics-*', coverage, ['load']),
      ...analysis.warningFor('alias-*', new Map([...coverage].reverse()), ['cpu', 'memory']),
      ...analysis.warningFor(
        'other-*',
        new Map([
          ['one', new Set<string>()],
          ['three', new Set(['environment'])],
        ]),
        ['other']
      ),
    ]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toEqual(
      expect.objectContaining({
        sourcePatterns: ['metrics-*', 'alias-*'],
        columns: ['cpu', 'load', 'memory'],
        excludedIndices: ['one'],
        eligibleIndexCount: 2,
      })
    );
    expect(warnings[1].sourcePatterns).toEqual(['other-*']);
  });

  it('does not group different per-index exclusion reasons even when the field union is identical', () => {
    const analysis = analyzeDocumentFilter({ bool: { filter: [environment, serviceEnvironment] } });
    const warnings = groupDocumentFilterWarnings([
      ...analysis.warningFor(
        'a',
        new Map([
          ['one', new Set(['environment'])],
          ['two', new Set(['service.environment'])],
        ]),
        []
      ),
      ...analysis.warningFor(
        'b',
        new Map([
          ['one', new Set(['service.environment'])],
          ['two', new Set(['environment'])],
        ]),
        []
      ),
    ]);
    expect(warnings).toHaveLength(2);
  });
});
