/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/logging';
import type {
  EntityDefinition,
  EntityDefinitionWithoutId,
  MaterialisationMode,
} from '../../../common/domain/definitions/entity_schema';
import { getMaterialisationMode } from '../../../common/domain/definitions/entity_schema';
import {
  isBuiltInEntityType,
  type BuiltInEntityType,
} from '../../../common/domain/definitions/built_in_entity_types';
import {
  getEntityDefinition as getBuiltInEntityDefinition,
  getMaterialisedEntityTypes,
} from '../../../common/domain/definitions/registry';
import type { EntityDefinitionRecord } from '../../../common/domain/definitions/definition_record';
import type { CodeDefinitionsRegistry } from './code_definitions_registry';
import type { EntityDefinitionsCache } from './definitions_cache';
import type { EntityDefinitionsRepository } from './definitions_repository';
import {
  validateStoredEntityDefinition,
  type StoredEntityDefinitionAttributes,
} from './saved_object';

export interface GetDefinitionsOptions {
  /** Only definitions whose materialisation mode matches. */
  mode?: MaterialisationMode;
}

/** Id stamped on dynamic (code or API) definitions; built-ins keep `security_<type>_<space>`. */
export const getDynamicEntityDefinitionId = (type: string, namespace: string): string =>
  `registered_${type}_${namespace}`;

interface EntityDefinitionRegistryDeps {
  repository: EntityDefinitionsRepository;
  cache: EntityDefinitionsCache;
  codeDefinitions: CodeDefinitionsRegistry;
  namespace: string;
  logger?: Logger;
}

/**
 * Resolves entity definitions by type name for one space: the four built-ins, definitions
 * registered in code at setup, and definitions registered per space through the API. Read-only;
 * writes go through `EntityDefinitionsClient`, which shares the cache.
 */
export class EntityDefinitionRegistry {
  private readonly repository: EntityDefinitionsRepository;
  private readonly cache: EntityDefinitionsCache;
  private readonly codeDefinitions: CodeDefinitionsRegistry;
  private readonly namespace: string;
  private readonly logger: Logger | undefined;

  constructor({
    repository,
    cache,
    codeDefinitions,
    namespace,
    logger,
  }: EntityDefinitionRegistryDeps) {
    this.repository = repository;
    this.cache = cache;
    this.codeDefinitions = codeDefinitions;
    this.namespace = namespace;
    this.logger = logger;
  }

  /** Whether `type` is one of the four static Security types. */
  isBuiltIn(type: string): boolean {
    return isBuiltInEntityType(type);
  }

  /** Whether `type` is defined in code (built-in or registered at setup) and so cannot be registered through the API. */
  isReserved(type: string): boolean {
    return isBuiltInEntityType(type) || this.codeDefinitions.has(type);
  }

  async getDefinition(type: string): Promise<EntityDefinitionRecord | undefined> {
    if (isBuiltInEntityType(type)) {
      return builtInRecord(type, this.namespace);
    }
    const code = this.codeDefinitions.get(type);
    if (code) {
      return codeRecord(code, this.namespace);
    }
    const stored = (await this.loadStored()).get(type);
    return stored ? apiRecord(stored, this.namespace) : undefined;
  }

  async getDefinitions({ mode }: GetDefinitionsOptions = {}): Promise<EntityDefinitionRecord[]> {
    const stored = await this.loadStored();
    const records: EntityDefinitionRecord[] = [
      ...getMaterialisedEntityTypes().map((type) => builtInRecord(type, this.namespace)),
      ...this.codeDefinitions.values().map((definition) => codeRecord(definition, this.namespace)),
      ...[...stored.values()].map((attributes) => apiRecord(attributes, this.namespace)),
    ];
    if (mode === undefined) {
      return records;
    }
    return records.filter(({ definition }) => getMaterialisationMode(definition) === mode);
  }

  private async loadStored(): Promise<ReadonlyMap<string, StoredEntityDefinitionAttributes>> {
    const cached = this.cache.get(this.namespace);
    if (cached) {
      return cached;
    }
    // Objects may have been imported rather than written through the API, so the registration
    // rules are re-applied on read; anything that fails them is ignored, not served.
    const all = (await this.repository.findAll()).flatMap(({ id, attributes }) => {
      const reason = validateStoredEntityDefinition(attributes, this.codeDefinitions);
      if (reason === undefined) {
        return [attributes];
      }
      this.logger?.warn(
        `Ignoring stored entity definition "${attributes.type}" (saved object ${id}) in space "${this.namespace}": ${reason}`
      );
      return [];
    });
    this.cache.set(this.namespace, all);
    return new Map(all.map((stored) => [stored.type, stored]));
  }
}

const builtInRecord = (type: BuiltInEntityType, namespace: string): EntityDefinitionRecord => ({
  definition: getBuiltInEntityDefinition(type, namespace),
  source: 'built_in',
});

const codeRecord = (
  definition: EntityDefinitionWithoutId,
  namespace: string
): EntityDefinitionRecord => ({
  definition: withDynamicId(definition, namespace),
  source: 'code',
});

export const apiRecord = (
  { definition, createdAt, updatedAt }: StoredEntityDefinitionAttributes,
  namespace: string
): EntityDefinitionRecord => ({
  definition: withDynamicId(definition, namespace),
  source: 'api',
  createdAt,
  updatedAt,
});

const withDynamicId = (
  definition: EntityDefinitionWithoutId,
  namespace: string
): EntityDefinition => ({
  ...definition,
  id: getDynamicEntityDefinitionId(definition.type, namespace),
});
