/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/** Routes map it to 409. */
export class InventoryExtensionAlreadyExistsError extends Error {
  constructor(type: string, namespace: string) {
    super(
      `An inventory extension for built-in entity type "${type}" is already registered in space "${namespace}"; use PUT to replace it`
    );
    this.name = 'InventoryExtensionAlreadyExistsError';
  }
}
