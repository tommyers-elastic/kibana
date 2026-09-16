/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { formatCellValue } from './format_cell_value';

describe('formatCellValue', () => {
  it('rounds numbers to four decimals and adds thousands separators', () => {
    expect(formatCellValue(0.123456789)).toBe('0.1235');
    expect(formatCellValue(42)).toBe('42');
    expect(formatCellValue(1.5)).toBe('1.5');
    expect(formatCellValue(1234567.891)).toBe('1,234,567.891');
  });

  it('returns undefined for nullish values and JSON for structured ones', () => {
    expect(formatCellValue(null)).toBeUndefined();
    expect(formatCellValue(undefined)).toBeUndefined();
    expect(formatCellValue('pod-1')).toBe('pod-1');
    expect(formatCellValue(true)).toBe('true');
    expect(formatCellValue(['a', 'b'])).toBe('["a","b"]');
  });
});
