/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { BuiltInInventoryExtension } from '../../../common/domain/definitions/inventory_schema';
import { builtInInventoryExtensionSchema } from '../../../common/domain/definitions/inventory_schema';
import {
  isBuiltInEntityType,
  type BuiltInEntityType,
} from '../../../common/domain/definitions/built_in_entity_types';
import { getEntityDefinitionWithoutId } from '../../../common/domain/definitions/registry';
import { getEuidSourceFieldsFromDefinition } from '../../../common/domain/euid';
import { EntityDefinitionValidationError } from './errors';

/**
 * Inventory extensions attached by plugins at setup to the built-in (Security) types through
 * `registerInventoryExtension`: global across spaces, held in memory, one per type. The built-in
 * definition itself is never changed; the server registry merges the extension into the record it
 * serves so the identity (and every derived entity id) stays the built-in's.
 */
export class BuiltInInventoryExtensionsRegistry {
  private readonly byType = new Map<string, BuiltInInventoryExtension>();

  register(type: string, candidate: unknown): void {
    if (!isBuiltInEntityType(type)) {
      throw new EntityDefinitionValidationError(
        `"${type}" is not a built-in entity type; register a full definition with registerEntityDefinition instead`
      );
    }
    if (this.byType.has(type)) {
      throw new EntityDefinitionValidationError(
        `An inventory extension is already registered for built-in entity type "${type}"`
      );
    }
    const extension = parseBuiltInInventoryExtension(candidate);
    assertAttributesAreNotIdentityFields(type, extension);
    this.byType.set(type, extension);
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

const parseBuiltInInventoryExtension = (candidate: unknown): BuiltInInventoryExtension => {
  const result = builtInInventoryExtensionSchema.safeParse(candidate);
  if (!result.success) {
    throw new EntityDefinitionValidationError(
      `Invalid inventory extension: ${result.error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ')}`
    );
  }
  return result.data;
};

/**
 * The authored form rejects attributes that repeat `inventory.identity`; for a built-in the
 * identity is the fields its `identityField` ranking references, so the same rule is applied
 * against those.
 */
const assertAttributesAreNotIdentityFields = (
  type: BuiltInEntityType,
  { attributes }: BuiltInInventoryExtension
): void => {
  if (!attributes?.length) {
    return;
  }
  const { identitySourceFields } = getEuidSourceFieldsFromDefinition(
    getEntityDefinitionWithoutId(type)
  );
  const identity = new Set(identitySourceFields);
  const clashes = attributes.filter((field) => identity.has(field));
  if (clashes.length > 0) {
    throw new EntityDefinitionValidationError(
      `Invalid inventory extension for "${type}": ${clashes
        .map((field) => `attribute "${field}" is an identity field of the built-in definition`)
        .join('; ')}`
    );
  }
};
