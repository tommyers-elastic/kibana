/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { describeHttpError } from './http_error';

describe('describeHttpError', () => {
  it('prefers the server body message and reports the status', () => {
    expect(
      describeHttpError({
        message: 'Bad Request',
        body: { message: 'inventory.sources: at least 1 source' },
        response: { status: 400 },
      })
    ).toEqual({ statusCode: 400, message: 'inventory.sources: at least 1 source' });
  });

  it('falls back to the error message or the stringified value', () => {
    expect(describeHttpError(new Error('offline'))).toEqual({ message: 'offline' });
    expect(describeHttpError('boom')).toEqual({ message: 'boom' });
  });
});
