/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { BuiltInInventoryExtension } from '../../../common/domain/definitions/inventory_schema';
import { EntityDefinitionValidationError } from './errors';
import { assertRegistrableExtension, parseExtensionDocument } from './registration_rules';

/**
 * Inventory extensions attached by plugins at setup to the built-in (Security) types through
 * `registerInventoryExtension({ extends, inventory })`: global across spaces, held in memory, one
 * per type. The built-in definition itself is never changed; the server registry merges the
 * extension into the record it serves so the identity (and every derived entity id) stays the
 * built-in's. A code extension wins over an API extension of the same type.
 */
export class BuiltInInventoryExtensionsRegistry {
  private readonly byType = new Map<string, BuiltInInventoryExtension>();

  register(candidate: unknown): void {
    const document = parseExtensionDocument(candidate);
    const type = assertRegistrableExtension(document);
    if (this.byType.has(type)) {
      throw new EntityDefinitionValidationError(
        `An inventory extension is already registered in code for built-in entity type "${type}"`
      );
    }
    this.byType.set(type, document.inventory);
  }

  has(type: string): boolean {
    return this.byType.has(type);
  }

  get(type: string): BuiltInInventoryExtension | undefined {
    return this.byType.get(type);
  }

  types(): string[] {
    return [...this.byType.keys()];
  }
}
