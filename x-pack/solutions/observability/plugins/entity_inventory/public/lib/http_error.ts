/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

export interface DescribedError {
  statusCode?: number;
  message: string;
}

interface HttpErrorLike {
  message?: unknown;
  body?: { message?: unknown } | null;
  response?: { status?: number } | null;
}

/**
 * Extracts the server's message (`body.message`, which the definitions API fills with the
 * validation text) and status from a core `http` fetch error, or falls back to the error text.
 */
export const describeHttpError = (error: unknown): DescribedError => {
  if (error === null || typeof error !== 'object') {
    return { message: String(error) };
  }
  const { message, body, response } = error as HttpErrorLike;
  const serverMessage = typeof body?.message === 'string' ? body.message : undefined;
  return {
    statusCode: response?.status,
    message: serverMessage ?? (typeof message === 'string' ? message : 'Unknown error'),
  };
};
