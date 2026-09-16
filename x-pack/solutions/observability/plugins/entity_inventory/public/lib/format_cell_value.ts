/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

const DECIMALS = 4;

/** Renders one inventory row value as text; numbers are rounded to four decimals. */
export const formatCellValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '-';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(DECIMALS)));
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
};
