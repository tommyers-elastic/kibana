/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { EntityDefinitionWithoutId } from '../../../common/domain/definitions/entity_schema';
import { assertRegistrableDefinition, parseDefinitionInput } from './registration_rules';

/**
 * Definitions registered by plugins at setup through `registerEntityDefinition`: global across
 * spaces, held in memory, never materialised. Their type names are reserved for the API, like the
 * built-ins.
 */
export class CodeDefinitionsRegistry {
  private readonly byType = new Map<string, EntityDefinitionWithoutId>();

  register(candidate: EntityDefinitionWithoutId): void {
    const definition = parseDefinitionInput(candidate);
    assertRegistrableDefinition(definition, { reservedTypes: this.byType });
    this.byType.set(definition.type, definition);
  }

  has(type: string): boolean {
    return this.byType.has(type);
  }

  get(type: string): EntityDefinitionWithoutId | undefined {
    return this.byType.get(type);
  }

  values(): EntityDefinitionWithoutId[] {
    return [...this.byType.values()];
  }
}
