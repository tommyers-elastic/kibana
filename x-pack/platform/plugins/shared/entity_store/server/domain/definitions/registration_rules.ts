/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { EntityDefinitionWithoutId } from '../../../common/domain/definitions/entity_schema';
import {
  entityDefinitionInputSchema,
  getMaterialisationMode,
} from '../../../common/domain/definitions/entity_schema';
import { isBuiltInEntityType } from '../../../common/domain/definitions/built_in_entity_types';
import { EntityDefinitionValidationError } from './errors';

/** Validates a candidate against the definition schema, throwing a validation error with zod's message. */
export function parseDefinitionInput(candidate: unknown): EntityDefinitionWithoutId {
  const result = entityDefinitionInputSchema.safeParse(candidate);
  if (!result.success) {
    throw new EntityDefinitionValidationError(
      `Invalid entity definition: ${result.error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ')}`
    );
  }
  return result.data;
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
