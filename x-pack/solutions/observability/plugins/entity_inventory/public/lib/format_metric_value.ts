/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import numeral from '@elastic/numeral';
import { i18n } from '@kbn/i18n';

const secondsPerUnit: Record<string, number> = {
  ns: 1e-9,
  nanoseconds: 1e-9,
  us: 1e-6,
  micros: 1e-6,
  microseconds: 1e-6,
  ms: 1e-3,
  milliseconds: 1e-3,
  s: 1,
  seconds: 1,
};

/** Formats chart values using the declared unit, without inferring units from metric names. */
export const formatMetricValue = (value: number, unit?: string): string => {
  if (unit === 'bytes') return numeral(value).format('0.[0]b');
  const number = new Intl.NumberFormat(i18n.getLocale(), {
    maximumSignificantDigits: 3,
    notation: 'compact',
  });
  if (unit === 'ratio' || unit === 'percent' || unit === '%') {
    return new Intl.NumberFormat(i18n.getLocale(), {
      style: 'percent',
      maximumFractionDigits: 1,
    }).format(unit === 'ratio' ? value : value / 100);
  }
  const multiplier = unit && Object.hasOwn(secondsPerUnit, unit) ? secondsPerUnit[unit] : undefined;
  if (multiplier !== undefined) {
    const seconds = value * multiplier;
    const magnitude = Math.abs(seconds);
    if (magnitude >= 3600) return `${number.format(seconds / 3600)} h`;
    if (magnitude >= 60) return `${number.format(seconds / 60)} min`;
    if (magnitude >= 1) return `${number.format(seconds)} s`;
    if (magnitude >= 1e-3) return `${number.format(seconds * 1e3)} ms`;
    if (magnitude >= 1e-6) return `${number.format(seconds * 1e6)} µs`;
    return `${number.format(seconds * 1e9)} ns`;
  }
  return unit ? `${number.format(value)} ${unit}` : number.format(value);
};
