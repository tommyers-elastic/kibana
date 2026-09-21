/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { EntityDefinitionWithoutId } from './entity_schema';
import { identityTupleToIdentityField } from './identity_tuple';
import type { InventoryExtension } from './inventory_schema';

export interface InventoryEntityDefinitionInput {
  type: string;
  name: string;
  /** Ordered tuple of literal field paths; becomes the core `identityField` (see `identityTupleToIdentityField`). */
  identity: readonly string[];
  inventory: InventoryExtension;
}

/** A non-materialised definition carrying an inventory extension. */
export type InventoryEntityDefinition = EntityDefinitionWithoutId & {
  inventory: InventoryExtension;
};

/**
 * Fixture and test helper, not schema: assembles a non-materialised entity definition from a
 * tuple identity and an inventory extension. The identity core is derived with
 * `identityTupleToIdentityField` and materialisation is switched off, so the definition is fully
 * usable by the EUID compiler and the inventory query generator but never gets extraction tasks,
 * component templates or install steps. Authored definitions declare `identityField` directly.
 */
export function buildInventoryEntityDefinition({
  type,
  name,
  identity,
  inventory,
}: InventoryEntityDefinitionInput): InventoryEntityDefinition {
  return {
    type,
    name,
    identityField: identityTupleToIdentityField(identity),
    materialisation: { mode: 'none' },
    inventory,
  };
}
