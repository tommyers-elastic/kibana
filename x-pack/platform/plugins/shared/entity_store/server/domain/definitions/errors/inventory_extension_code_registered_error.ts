/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * A code-registered extension (setup contract) exists for the built-in type; it wins over API
 * extensions, so the API can neither create, replace nor delete one. Routes map it to 409.
 */
export class InventoryExtensionCodeRegisteredError extends Error {
  constructor(type: string) {
    super(
      `The inventory extension for built-in entity type "${type}" is registered in code and cannot be created, replaced or deleted through the API`
    );
    this.name = 'InventoryExtensionCodeRegisteredError';
  }
}
