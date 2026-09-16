/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { InventoryDocumentCount, InventoryQueryInfo } from '../../common';

export interface DocumentsInWindow {
  /** Sum over every source pattern, or undefined when any pattern failed to count. */
  total: number | undefined;
  errors: string[];
}

/** Sums `documentsInWindow`; a single failed pattern makes the total unknown rather than too small. */
export const sumDocumentsInWindow = (counts: InventoryDocumentCount[]): DocumentsInWindow => {
  const errors = counts.flatMap(({ index, documentsInWindow, error }) =>
    documentsInWindow === null || error !== undefined ? [`${index}: ${error ?? 'no count'}`] : []
  );
  const total =
    errors.length > 0
      ? undefined
      : counts.reduce((sum, { documentsInWindow }) => sum + (documentsInWindow ?? 0), 0);
  return { total, errors };
};

/** Documents Elasticsearch read for the source queries; the `COUNT` query's scan is its own. */
export const sumProcessedDocuments = (queries: InventoryQueryInfo[]): number =>
  queries
    .filter(({ engine }) => engine !== 'COUNT')
    .reduce((sum, { documentsFound }) => sum + (documentsFound ?? 0), 0);

/** Processed as a percentage of in-window, or undefined when in-window is unknown or zero. */
export const documentShare = (
  processed: number | undefined,
  inWindow: number | undefined
): number | undefined =>
  processed === undefined || inWindow === undefined || inWindow === 0
    ? undefined
    : (processed / inWindow) * 100;

export const formatPercent = (value: number | undefined): string | undefined =>
  value === undefined
    ? undefined
    : `${value.toLocaleString('en-US', { maximumFractionDigits: value < 10 ? 2 : 1 })}%`;
