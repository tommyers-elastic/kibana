/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ZodSafeParseResult } from '@kbn/zod/v4';
import type {
  BuiltInInventoryExtensionDocument,
  EntityDefinitionWithoutId,
} from '../../../common/domain/definitions/entity_schema';
import {
  builtInInventoryExtensionDocumentSchema,
  entityDefinitionInputSchema,
  getMaterialisationMode,
} from '../../../common/domain/definitions/entity_schema';
import {
  entityDefinitionsApiBodySchema,
  type EntityDefinitionsApiBody,
} from '../../../common/domain/definitions/definitions_api_body';
import {
  isBuiltInEntityType,
  type BuiltInEntityType,
} from '../../../common/domain/definitions/built_in_entity_types';
import { getEntityDefinitionWithoutId } from '../../../common/domain/definitions/registry';
import { getEuidSourceFieldsFromDefinition } from '../../../common/domain/euid';
import { EntityDefinitionValidationError } from './errors';

const unwrap = <T>(result: ZodSafeParseResult<T>, subject: string): T => {
  if (!result.success) {
    throw new EntityDefinitionValidationError(
      `Invalid ${subject}: ${result.error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ')}`
    );
  }
  return result.data;
};

/** Validates a candidate against the definition schema, throwing a validation error with zod's message. */
export function parseDefinitionInput(candidate: unknown): EntityDefinitionWithoutId {
  return unwrap(entityDefinitionInputSchema.safeParse(candidate), 'entity definition');
}

/** Validates a candidate `{ extends, inventory }` document, throwing a validation error with zod's message. */
export function parseExtensionDocument(candidate: unknown): BuiltInInventoryExtensionDocument {
  return unwrap(
    builtInInventoryExtensionDocumentSchema.safeParse(candidate),
    'inventory extension document'
  );
}

/** Validates a definitions API body of either kind (full definition or extension document). */
export function parseDefinitionsApiBody(candidate: unknown): EntityDefinitionsApiBody {
  return unwrap(entityDefinitionsApiBodySchema.safeParse(candidate), 'entity definition document');
}

/**
 * Registration rules shared by code and API registration of built-in inventory extensions: the
 * extended type must be a built-in (anything else is a full definition, registered with `type`),
 * and attributes may not be identity fields of the built-in (the authored form's "attributes may
 * not repeat identity" rule, applied against the fields the built-in ranking references). Returns
 * the extended type narrowed to `BuiltInEntityType`.
 */
export function assertRegistrableExtension({
  extends: type,
  inventory,
}: BuiltInInventoryExtensionDocument): BuiltInEntityType {
  if (!isBuiltInEntityType(type)) {
    throw new EntityDefinitionValidationError(
      `"${type}" is not a built-in entity type and cannot be extended; register a full entity definition with "type" instead`
    );
  }
  const attributes = inventory.attributes ?? [];
  if (attributes.length > 0) {
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
  }
  return type;
}

/**
 * Registration rules shared by code and API registration: reserved names cannot be redefined and
 * dynamic definitions cannot be materialised (materialised types need per-type templates, tasks and
 * config, which only the built-ins have).
 */
export function assertRegistrableDefinition(
  definition: EntityDefinitionWithoutId,
  { reservedTypes }: { reservedTypes: { has(type: string): boolean } }
): void {
  if (isBuiltInEntityType(definition.type)) {
    throw new EntityDefinitionValidationError(
      `"${definition.type}" is a built-in entity type and cannot be registered, replaced or deleted`
    );
  }
  if (reservedTypes.has(definition.type)) {
    throw new EntityDefinitionValidationError(
      `"${definition.type}" is registered in code and cannot be registered through the API`
    );
  }
  const mode = getMaterialisationMode(definition);
  if (mode !== 'none') {
    throw new EntityDefinitionValidationError(
      `Dynamic entity definitions cannot be materialised: materialisation.mode must be "none" (got "${mode}")`
    );
  }
}
