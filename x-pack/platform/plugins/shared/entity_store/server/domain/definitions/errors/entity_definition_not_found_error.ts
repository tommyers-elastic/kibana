/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/** Routes map it to 404. */
export class EntityDefinitionNotFoundError extends Error {
  constructor(type: string, namespace: string) {
    super(`No registered entity definition of type "${type}" in space "${namespace}"`);
    this.name = 'EntityDefinitionNotFoundError';
  }
}
