/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { RELATIVE_RANGES, relativeRangeToAbsolute } from './time_range';

describe('relativeRangeToAbsolute', () => {
  const now = new Date('2026-01-15T12:00:00.000Z');

  it('resolves each relative range to absolute ISO instants ending at now', () => {
    expect(relativeRangeToAbsolute('15m', now)).toEqual({
      from: '2026-01-15T11:45:00.000Z',
      to: '2026-01-15T12:00:00.000Z',
    });
    expect(relativeRangeToAbsolute('1h', now).from).toBe('2026-01-15T11:00:00.000Z');
    expect(relativeRangeToAbsolute('6h', now).from).toBe('2026-01-15T06:00:00.000Z');
    expect(relativeRangeToAbsolute('24h', now).from).toBe('2026-01-14T12:00:00.000Z');
    expect(relativeRangeToAbsolute('3d', now).from).toBe('2026-01-12T12:00:00.000Z');
    expect(relativeRangeToAbsolute('7d', now).from).toBe('2026-01-08T12:00:00.000Z');
  });

  it('offers the windows shortest first with 15m as the first (default) option', () => {
    expect(RELATIVE_RANGES).toEqual(['15m', '1h', '6h', '24h', '3d', '7d']);
  });
});
