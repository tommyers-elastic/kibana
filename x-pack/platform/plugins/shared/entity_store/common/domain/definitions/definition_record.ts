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
 * Where the inventory extension of a built-in definition comes from:
 * - `code`: attached at setup through `registerInventoryExtension` (global, wins over `api`).
 * - `api`: an extension document (`{ extends, inventory }`) registered per space through the API.
 */
export type EntityDefinitionInventorySource = 'code' | 'api';

/**
 * A resolved definition plus where it came from and, for `api` definitions, when it was written.
 * Versioning is the author's: a definition may carry its own `version` in the core schema.
 */
export interface EntityDefinitionRecord {
  definition: EntityDefinition;
  source: EntityDefinitionSource;
  /**
   * Set only on a built-in whose `definition.inventory` is a registered extension; the definition
   * itself is still `built_in`. `createdAt` / `updatedAt` are then the extension's (`api` only).
   */
  inventorySource?: EntityDefinitionInventorySource;
  createdAt?: string;
  updatedAt?: string;
}
