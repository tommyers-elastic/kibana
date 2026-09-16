/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

const MAX_FRACTION_DIGITS = 4;

const numberFormat = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: MAX_FRACTION_DIGITS,
});

/**
 * Renders one inventory row value as text: numbers with thousands separators and at most four
 * decimals, structured values as JSON; `undefined` for a missing value so the caller can render a
 * placeholder.
 */
export const formatCellValue = (value: unknown): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'number') {
    return numberFormat.format(value);
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
};
