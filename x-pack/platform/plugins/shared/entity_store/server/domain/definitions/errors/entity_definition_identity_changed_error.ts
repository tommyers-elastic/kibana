/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * A replace would change the identity of an existing definition, which changes every entity id it
 * produces. Routes map it to 409; the caller must pass `force=true` to proceed.
 */
export class EntityDefinitionIdentityChangedError extends Error {
  constructor(type: string) {
    super(
      `Replacing entity definition "${type}" changes its identity, so ids derived under the previous ` +
        `identity are no longer comparable. Pass force=true to replace it anyway.`
    );
    this.name = 'EntityDefinitionIdentityChangedError';
  }
}
