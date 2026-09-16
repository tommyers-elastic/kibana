/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { InventoryQueryInfo } from '../../common';
import {
  documentShare,
  formatPercent,
  sumDocumentsInWindow,
  sumProcessedDocuments,
} from './document_stats';

describe('sumDocumentsInWindow', () => {
  it('sums every pattern when all counted', () => {
    expect(
      sumDocumentsInWindow([
        { index: 'metrics-a-*', documentsInWindow: 1200 },
        { index: 'metrics-b-*', documentsInWindow: 300, tookMs: 4 },
      ])
    ).toEqual({ total: 1500, errors: [] });
  });

  it('makes the total unknown and lists the failures when a pattern errored', () => {
    expect(
      sumDocumentsInWindow([
        { index: 'metrics-a-*', documentsInWindow: 1200 },
        { index: 'metrics-b-*', documentsInWindow: null, error: 'index_not_found' },
      ])
    ).toEqual({ total: undefined, errors: ['metrics-b-*: index_not_found'] });
  });
});

describe('sumProcessedDocuments', () => {
  it('sums documentsFound over the source queries and skips the COUNT query', () => {
    const queries: InventoryQueryInfo[] = [
      { index: 'metrics-a-*', engine: 'TS', esql: '', documentsFound: 800 },
      { index: 'metrics-b-*', engine: 'FROM', esql: '', documentsFound: 150 },
      { index: '*', engine: 'COUNT', esql: '', documentsFound: 950 },
      { index: 'metrics-c-*', engine: 'FROM', esql: '' },
    ];
    expect(sumProcessedDocuments(queries)).toBe(950);
  });
});

describe('documentShare and formatPercent', () => {
  it('computes the percentage and formats it with adaptive precision', () => {
    expect(documentShare(950, 1500)).toBeCloseTo(63.333, 3);
    expect(formatPercent(documentShare(950, 1500))).toBe('63.3%');
    expect(formatPercent(documentShare(12, 1500))).toBe('0.8%');
    expect(documentShare(950, undefined)).toBeUndefined();
    expect(documentShare(950, 0)).toBeUndefined();
    expect(formatPercent(undefined)).toBeUndefined();
  });
});
