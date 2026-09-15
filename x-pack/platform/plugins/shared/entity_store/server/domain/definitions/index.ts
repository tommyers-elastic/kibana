/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

export { EntityDefinitionSavedObjectType, getEntityDefinitionSavedObjectId } from './saved_object';
export type { StoredEntityDefinitionAttributes } from './saved_object';
export { EntityDefinitionsCache, DEFINITIONS_CACHE_TTL_MS } from './definitions_cache';
export {
  EntityDefinitionsRepository,
  MAX_DEFINITIONS_PER_SPACE,
  type EntityDefinitionsSavedObjectsClient,
  type StoredEntityDefinition,
} from './definitions_repository';
export {
  EntityDefinitionRegistry,
  getDynamicEntityDefinitionId,
  type GetDefinitionsOptions,
} from './registry';
export { CodeDefinitionsRegistry } from './code_definitions_registry';
export { EntityDefinitionsClient, type ReplaceDefinitionOptions } from './definitions_client';
export {
  EntityDefinitionValidationError,
  EntityDefinitionNotFoundError,
  EntityDefinitionAlreadyExistsError,
  EntityDefinitionIdentityChangedError,
} from './errors';
