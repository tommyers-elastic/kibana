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
  inventory: InventoryExtension;
}

/** A non-materialised definition assembled from its inventory authoring form (identity included). */
export type InventoryEntityDefinition = EntityDefinitionWithoutId & {
  inventory: InventoryExtension;
};

/**
 * Assembles a non-materialised entity definition from its inventory authoring form: the identity
 * core is derived from `inventory.identity` and materialisation is switched off, so the definition
 * is fully usable by the EUID compiler and the inventory query generator but never gets extraction
 * tasks, component templates or install steps.
 */
export function buildInventoryEntityDefinition({
  type,
  name,
  inventory,
}: InventoryEntityDefinitionInput): InventoryEntityDefinition {
  return {
    type,
    name,
    identityField: identityTupleToIdentityField(inventory.identity, inventory.identityMode),
    materialisation: { mode: 'none' },
    inventory,
  };
}
