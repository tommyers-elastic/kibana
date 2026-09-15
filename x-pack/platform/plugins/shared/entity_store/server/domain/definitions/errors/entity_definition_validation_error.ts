/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/** A definition that is well-formed but violates a registration rule (routes map it to 400). */
export class EntityDefinitionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EntityDefinitionValidationError';
  }
}
