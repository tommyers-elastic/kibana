/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { EntityDefinition } from './entity_schema';

/**
 * Where a definition resolved by the registry comes from:
 * - `built_in`: one of the four static Security types (code, `mode: 'extraction'`, global).
 * - `code`: registered by a plugin at setup through the setup contract (code, `mode: 'none'`, global).
 * - `api`: registered per space through the definitions HTTP API (persisted, `mode: 'none'`).
 */
export type EntityDefinitionSource = 'built_in' | 'code' | 'api';

/**
 * A resolved definition plus where it came from and, for `api` definitions, when it was written.
 * Versioning is the author's: a definition may carry its own `version` in the core schema.
 */
export interface EntityDefinitionRecord {
  definition: EntityDefinition;
  source: EntityDefinitionSource;
  createdAt?: string;
  updatedAt?: string;
}
