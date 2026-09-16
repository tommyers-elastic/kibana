/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

export type RelativeRange = '15m' | '1h' | '6h' | '24h' | '3d' | '7d';

/** Offered in the preview, shortest first; wide windows are slower and may cap at 10,000 rows per source. */
export const RELATIVE_RANGES: readonly RelativeRange[] = [
  '15m',
  '1h',
  '6h',
  '24h',
  '3d',
  '7d',
] as const;

const RANGE_MINUTES: Record<RelativeRange, number> = {
  '15m': 15,
  '1h': 60,
  '6h': 6 * 60,
  '24h': 24 * 60,
  '3d': 72 * 60,
  '7d': 168 * 60,
};

export interface AbsoluteRange {
  from: string;
  to: string;
}

/** The inventory routes take absolute ISO instants only, so the window is resolved in the browser. */
export const relativeRangeToAbsolute = (
  range: RelativeRange,
  now: Date = new Date()
): AbsoluteRange => ({
  from: new Date(now.getTime() - RANGE_MINUTES[range] * 60_000).toISOString(),
  to: now.toISOString(),
});
