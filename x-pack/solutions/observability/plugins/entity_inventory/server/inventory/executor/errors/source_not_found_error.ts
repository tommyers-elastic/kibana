/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

export class SourceNotFoundError extends Error {
  constructor(public readonly index: string) {
    super(`no index matches "${index}"`);
    this.name = 'SourceNotFoundError';
  }
}
