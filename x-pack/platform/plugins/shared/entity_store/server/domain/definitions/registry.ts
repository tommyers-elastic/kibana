/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/logging';
import type {
  BuiltInInventoryExtension,
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
import type {
  EntityDefinitionInventorySource,
  EntityDefinitionRecord,
} from '../../../common/domain/definitions/definition_record';
import type { BuiltInInventoryExtensionsRegistry } from './built_in_inventory_extensions';
import type { CodeDefinitionsRegistry } from './code_definitions_registry';
import type { EntityDefinitionsCache } from './definitions_cache';
import type { EntityDefinitionsRepository } from './definitions_repository';
import type { InventoryExtensionsRepository } from './inventory_extensions_repository';
import {
  validateStoredInventoryExtension,
  type StoredInventoryExtensionAttributes,
} from './inventory_extension_saved_object';
import {
  validateStoredEntityDefinition,
  type StoredEntityDefinitionAttributes,
} from './saved_object';

export interface GetDefinitionsOptions {
  /** Only definitions whose materialisation mode matches. */
  mode?: MaterialisationMode;
  /**
   * When `true`, only definitions that carry an `inventory` extension: built-ins with an extension
   * registered in code or through the API, and code or API definitions that declare one.
   */
  inventory?: boolean;
}

/** Id stamped on dynamic (code or API) definitions; built-ins keep `security_<type>_<space>`. */
export const getDynamicEntityDefinitionId = (type: string, namespace: string): string =>
  `registered_${type}_${namespace}`;

/** Dependencies shared by the registry (reads) and the definitions client (writes) of one space. */
export interface EntityDefinitionsDeps {
  repository: EntityDefinitionsRepository;
  cache: EntityDefinitionsCache;
  codeDefinitions: CodeDefinitionsRegistry;
  extensionsRepository: InventoryExtensionsRepository;
  extensionsCache: EntityDefinitionsCache<StoredInventoryExtensionAttributes>;
  builtInInventoryExtensions: BuiltInInventoryExtensionsRegistry;
  namespace: string;
}

interface EntityDefinitionRegistryDeps extends EntityDefinitionsDeps {
  logger?: Logger;
}

/** A built-in's inventory extension with where it came from. */
export interface ResolvedInventoryExtension {
  inventory: BuiltInInventoryExtension;
  source: EntityDefinitionInventorySource;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Resolves entity definitions by type name for one space: the four built-ins, definitions
 * registered in code at setup, and definitions registered per space through the API. A built-in
 * is served with its inventory extension, if any: the one registered in code at setup wins over
 * the one registered in the space through the API. Read-only; writes go through
 * `EntityDefinitionsClient`, which shares the caches.
 */
export class EntityDefinitionRegistry {
  private readonly repository: EntityDefinitionsRepository;
  private readonly cache: EntityDefinitionsCache;
  private readonly codeDefinitions: CodeDefinitionsRegistry;
  private readonly extensionsRepository: InventoryExtensionsRepository;
  private readonly extensionsCache: EntityDefinitionsCache<StoredInventoryExtensionAttributes>;
  private readonly builtInInventoryExtensions: BuiltInInventoryExtensionsRegistry;
  private readonly namespace: string;
  private readonly logger: Logger | undefined;

  constructor({
    repository,
    cache,
    codeDefinitions,
    extensionsRepository,
    extensionsCache,
    builtInInventoryExtensions,
    namespace,
    logger,
  }: EntityDefinitionRegistryDeps) {
    this.repository = repository;
    this.cache = cache;
    this.codeDefinitions = codeDefinitions;
    this.extensionsRepository = extensionsRepository;
    this.extensionsCache = extensionsCache;
    this.builtInInventoryExtensions = builtInInventoryExtensions;
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
      return builtInRecord(type, this.namespace, await this.getInventoryExtension(type));
    }
    const code = this.codeDefinitions.get(type);
    if (code) {
      return codeRecord(code, this.namespace);
    }
    const stored = (await this.loadStored()).get(type);
    return stored ? apiRecord(stored, this.namespace) : undefined;
  }

  async getDefinitions({ mode, inventory }: GetDefinitionsOptions = {}): Promise<
    EntityDefinitionRecord[]
  > {
    const [stored, storedExtensions] = await Promise.all([
      this.loadStored(),
      this.loadStoredExtensions(),
    ]);
    const records: EntityDefinitionRecord[] = [
      ...getMaterialisedEntityTypes().map((type) =>
        builtInRecord(type, this.namespace, this.resolveInventoryExtension(type, storedExtensions))
      ),
      ...this.codeDefinitions.values().map((definition) => codeRecord(definition, this.namespace)),
      ...[...stored.values()].map((attributes) => apiRecord(attributes, this.namespace)),
    ];
    return records.filter(
      ({ definition }) =>
        (mode === undefined || getMaterialisationMode(definition) === mode) &&
        (!inventory || definition.inventory !== undefined)
    );
  }

  /**
   * The inventory extension of a built-in type, if any: the code-registered one first, else the
   * one stored in this space. `undefined` for a type that is not built-in or has no extension.
   */
  async getInventoryExtension(type: string): Promise<ResolvedInventoryExtension | undefined> {
    if (!isBuiltInEntityType(type)) {
      return undefined;
    }
    const code = this.builtInInventoryExtensions.get(type);
    if (code) {
      return { inventory: code, source: 'code' };
    }
    return this.resolveInventoryExtension(type, await this.loadStoredExtensions());
  }

  /** Code-registered extension first, else the space's stored one, else none. */
  private resolveInventoryExtension(
    type: BuiltInEntityType,
    storedExtensions: ReadonlyMap<string, StoredInventoryExtensionAttributes>
  ): ResolvedInventoryExtension | undefined {
    const code = this.builtInInventoryExtensions.get(type);
    if (code) {
      return { inventory: code, source: 'code' };
    }
    const stored = storedExtensions.get(type);
    if (!stored) {
      return undefined;
    }
    const { document, createdAt, updatedAt } = stored;
    return { inventory: document.inventory, source: 'api', createdAt, updatedAt };
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

  private async loadStoredExtensions(): Promise<
    ReadonlyMap<string, StoredInventoryExtensionAttributes>
  > {
    const cached = this.extensionsCache.get(this.namespace);
    if (cached) {
      return cached;
    }
    const all = (await this.extensionsRepository.findAll()).flatMap(({ id, attributes }) => {
      const reason = validateStoredInventoryExtension(attributes, this.builtInInventoryExtensions);
      if (reason === undefined) {
        return [attributes];
      }
      this.logger?.warn(
        `Ignoring stored inventory extension for "${attributes.type}" (saved object ${id}) in space "${this.namespace}": ${reason}`
      );
      return [];
    });
    this.extensionsCache.set(this.namespace, all);
    return new Map(all.map((stored) => [stored.type, stored]));
  }
}

/**
 * The record served for a built-in: the static definition, with `inventory` and the extension's
 * provenance and timestamps merged in when an extension is registered. The definition's own
 * `source` stays `built_in`.
 */
export const builtInRecord = (
  type: BuiltInEntityType,
  namespace: string,
  extension?: ResolvedInventoryExtension
): EntityDefinitionRecord => {
  const definition = getBuiltInEntityDefinition(type, namespace);
  if (!extension) {
    return { definition, source: 'built_in' };
  }
  const { inventory, source: inventorySource, createdAt, updatedAt } = extension;
  return {
    definition: { ...definition, inventory },
    source: 'built_in',
    inventorySource,
    ...(createdAt !== undefined ? { createdAt } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  };
};

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
