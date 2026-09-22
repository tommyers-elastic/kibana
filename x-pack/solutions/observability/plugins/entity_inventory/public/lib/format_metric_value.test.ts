/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { formatMetricValue } from './format_metric_value';

describe('formatMetricValue', () => {
  it('uses byte units instead of a long integer', () => {
    expect(formatMetricValue(1024 ** 3, 'bytes')).toBe('1GB');
  });

  it('distinguishes normalized ratios, percentages, and cores', () => {
    expect(formatMetricValue(0.253, 'ratio')).toBe('25.3%');
    expect(formatMetricValue(25.3, 'percent')).toBe('25.3%');
    expect(formatMetricValue(0.253, 'cores')).toBe('0.253 cores');
  });

  it('converts durations according to the declared source unit', () => {
    expect(formatMetricValue(1500, 'ms')).toBe('1.5 s');
    expect(formatMetricValue(0.002, 's')).toBe('2 ms');
    expect(formatMetricValue(2500, 'micros')).toBe('2.5 ms');
  });

  it('keeps zero and small values and abbreviates large counts', () => {
    expect(formatMetricValue(0)).toBe('0');
    expect(formatMetricValue(0.00012)).toBe('0.00012');
    expect(formatMetricValue(12000)).toBe('12K');
    expect(formatMetricValue(3, 'requests/s')).toBe('3 requests/s');
    expect(formatMetricValue(3, 'constructor')).toBe('3 constructor');
  });
});
