/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { detailBodySchema } from './schemas';

describe('detailBodySchema', () => {
  it.each([
    { count: 8, accepted: true },
    { count: 9, accepted: false },
  ])('validates an identity with $count fields', ({ count, accepted }) => {
    const result = detailBodySchema.safeParse({
      from: '2026-09-01T00:00:00Z',
      to: '2026-09-02T00:00:00Z',
      identity: Object.fromEntries(
        Array.from({ length: count }, (_, index) => [`resource.key${index}`, 'value'])
      ),
    });
    expect(result.success).toBe(accepted);
    if (!result.success) {
      expect(result.error.issues).toEqual([
        expect.objectContaining({
          path: ['identity'],
          message: 'identity must have between 1 and 8 fields',
        }),
      ]);
    }
  });
});
