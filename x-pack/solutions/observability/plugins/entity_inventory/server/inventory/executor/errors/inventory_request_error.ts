/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/** A request that is well-formed but impossible for the type: unknown sort column, non-identity detail field. */
export class InventoryRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InventoryRequestError';
  }
}
