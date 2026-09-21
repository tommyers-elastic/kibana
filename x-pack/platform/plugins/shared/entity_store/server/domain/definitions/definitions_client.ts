/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { isEqual } from 'lodash';
import type { Logger } from '@kbn/logging';
import type {
  BuiltInInventoryExtensionDocument,
  EntityDefinitionWithoutId,
} from '../../../common/domain/definitions/entity_schema';
import { isBuiltInInventoryExtensionDocument } from '../../../common/domain/definitions/entity_schema';
import {
  isBuiltInEntityType,
  type BuiltInEntityType,
} from '../../../common/domain/definitions/built_in_entity_types';
import type { EntityDefinitionRecord } from '../../../common/domain/definitions/definition_record';
import type { EntityDefinitionsCache } from './definitions_cache';
import {
  MAX_DEFINITIONS_PER_SPACE,
  type EntityDefinitionsRepository,
  type StoredEntityDefinition,
} from './definitions_repository';
import type {
  InventoryExtensionsRepository,
  StoredInventoryExtension,
} from './inventory_extensions_repository';
import {
  EntityDefinitionAlreadyExistsError,
  EntityDefinitionIdentityChangedError,
  EntityDefinitionNotFoundError,
  EntityDefinitionValidationError,
  InventoryExtensionAlreadyExistsError,
  InventoryExtensionCodeRegisteredError,
} from './errors';
import type { BuiltInInventoryExtensionsRegistry } from './built_in_inventory_extensions';
import type { CodeDefinitionsRegistry } from './code_definitions_registry';
import type { StoredInventoryExtensionAttributes } from './inventory_extension_saved_object';
import {
  assertRegistrableDefinition,
  assertRegistrableExtension,
  parseDefinitionsApiBody,
} from './registration_rules';
import { apiRecord, builtInRecord, type EntityDefinitionsDeps } from './registry';

export interface ReplaceDefinitionOptions {
  /** Allow a replace that changes the identity (and therefore every derived entity id). */
  force?: boolean;
}

interface EntityDefinitionsClientDeps extends EntityDefinitionsDeps {
  logger: Logger;
  now?: () => Date;
}

/**
 * Write side of the definitions API for one space: dynamic (API) definitions and inventory
 * extensions of built-in types, dispatched on the body kind (`type` vs `extends`). Must be built
 * over a request-scoped saved objects client so saved-object authorization and the request's space
 * apply.
 */
export class EntityDefinitionsClient {
  private readonly repository: EntityDefinitionsRepository;
  private readonly cache: EntityDefinitionsCache;
  private readonly codeDefinitions: CodeDefinitionsRegistry;
  private readonly extensionsRepository: InventoryExtensionsRepository;
  private readonly extensionsCache: EntityDefinitionsCache<StoredInventoryExtensionAttributes>;
  private readonly builtInInventoryExtensions: BuiltInInventoryExtensionsRegistry;
  private readonly namespace: string;
  private readonly logger: Logger;
  private readonly now: () => Date;

  constructor({
    repository,
    cache,
    codeDefinitions,
    extensionsRepository,
    extensionsCache,
    builtInInventoryExtensions,
    namespace,
    logger,
    now = () => new Date(),
  }: EntityDefinitionsClientDeps) {
    this.repository = repository;
    this.cache = cache;
    this.codeDefinitions = codeDefinitions;
    this.extensionsRepository = extensionsRepository;
    this.extensionsCache = extensionsCache;
    this.builtInInventoryExtensions = builtInInventoryExtensions;
    this.namespace = namespace;
    this.logger = logger;
    this.now = now;
  }

  /** Creates a dynamic definition (`type`) or a built-in inventory extension (`extends`). */
  async create(candidate: unknown): Promise<EntityDefinitionRecord> {
    const body = parseDefinitionsApiBody(candidate);
    if (isBuiltInInventoryExtensionDocument(body)) {
      return this.createExtension(body);
    }
    return this.createDefinition(body);
  }

  /**
   * Replaces the dynamic definition of `type` (404 when none), or creates or replaces the inventory
   * extension of the built-in `type` when the body is an extension document (`force` is irrelevant
   * for extensions: they never carry identity).
   */
  async replace(
    type: string,
    candidate: unknown,
    { force = false }: ReplaceDefinitionOptions = {}
  ): Promise<EntityDefinitionRecord> {
    const body = parseDefinitionsApiBody(candidate);
    if (isBuiltInInventoryExtensionDocument(body)) {
      if (body.extends !== type) {
        throw new EntityDefinitionValidationError(
          `The extended type "${body.extends}" does not match the path type "${type}"`
        );
      }
      return this.putExtension(body);
    }
    return this.replaceDefinition(type, body, force);
  }

  /**
   * Deletes the dynamic definition of `type`, or, for a built-in type, its API-registered inventory
   * extension. A built-in without an API extension cannot be deleted.
   */
  async delete(type: string): Promise<void> {
    if (isBuiltInEntityType(type)) {
      return this.deleteExtension(type);
    }
    assertNotReserved(type, this.codeDefinitions);
    const existing = await this.findStored(type);
    if (!existing) {
      throw new EntityDefinitionNotFoundError(type, this.namespace);
    }
    await this.repository.delete(existing.id);
    this.cache.invalidate(this.namespace);
    this.logger.debug(`Deleted entity definition "${type}"`);
  }

  private async createDefinition(
    candidate: EntityDefinitionWithoutId
  ): Promise<EntityDefinitionRecord> {
    const definition = this.validateDefinition(candidate);
    // Bypass the cache: writes must see the latest persisted state.
    const all = await this.repository.findAll();
    if (all.some(({ attributes }) => attributes.type === definition.type)) {
      throw new EntityDefinitionAlreadyExistsError(definition.type, this.namespace);
    }
    if (all.length >= MAX_DEFINITIONS_PER_SPACE) {
      throw new EntityDefinitionValidationError(
        `At most ${MAX_DEFINITIONS_PER_SPACE} entity definitions can be registered per space`
      );
    }

    const timestamp = this.now().toISOString();
    const stored = await this.repository.create({
      type: definition.type,
      createdAt: timestamp,
      updatedAt: timestamp,
      definition,
    });
    this.cache.invalidate(this.namespace);
    this.logger.debug(`Registered entity definition "${definition.type}"`);
    return apiRecord(stored, this.namespace);
  }

  private async replaceDefinition(
    type: string,
    candidate: EntityDefinitionWithoutId,
    force: boolean
  ): Promise<EntityDefinitionRecord> {
    const definition = this.validateDefinition(candidate);
    if (definition.type !== type) {
      throw new EntityDefinitionValidationError(
        `The definition type "${definition.type}" does not match the path type "${type}"`
      );
    }
    const existing = await this.findStored(type);
    if (!existing) {
      throw new EntityDefinitionNotFoundError(type, this.namespace);
    }
    if (!force && identityChanged(existing.attributes.definition, definition)) {
      throw new EntityDefinitionIdentityChangedError(type);
    }

    const stored = await this.repository.replace(existing.id, {
      type,
      createdAt: existing.attributes.createdAt,
      updatedAt: this.now().toISOString(),
      definition,
    });
    this.cache.invalidate(this.namespace);
    this.logger.debug(`Replaced entity definition "${type}"`);
    return apiRecord(stored, this.namespace);
  }

  private async createExtension(
    document: BuiltInInventoryExtensionDocument
  ): Promise<EntityDefinitionRecord> {
    const type = this.validateExtension(document);
    if (await this.findStoredExtension(type)) {
      throw new InventoryExtensionAlreadyExistsError(type, this.namespace);
    }
    const timestamp = this.now().toISOString();
    const stored = await this.extensionsRepository.create({
      type,
      createdAt: timestamp,
      updatedAt: timestamp,
      document,
    });
    this.extensionsCache.invalidate(this.namespace);
    this.logger.debug(`Registered inventory extension for built-in entity type "${type}"`);
    return extensionRecord(stored, this.namespace);
  }

  /** Create-or-replace: idempotent, keeps `createdAt` across replaces. */
  private async putExtension(
    document: BuiltInInventoryExtensionDocument
  ): Promise<EntityDefinitionRecord> {
    const type = this.validateExtension(document);
    const existing = await this.findStoredExtension(type);
    if (!existing) {
      return this.createExtension(document);
    }
    const stored = await this.extensionsRepository.replace(existing.id, {
      type,
      createdAt: existing.attributes.createdAt,
      updatedAt: this.now().toISOString(),
      document,
    });
    this.extensionsCache.invalidate(this.namespace);
    this.logger.debug(`Replaced inventory extension for built-in entity type "${type}"`);
    return extensionRecord(stored, this.namespace);
  }

  private async deleteExtension(type: BuiltInEntityType): Promise<void> {
    if (this.builtInInventoryExtensions.has(type)) {
      throw new InventoryExtensionCodeRegisteredError(type);
    }
    const existing = await this.findStoredExtension(type);
    if (!existing) {
      throw new EntityDefinitionValidationError(
        `"${type}" is a built-in entity type and cannot be registered, replaced or deleted, and it has no API-registered inventory extension to delete`
      );
    }
    await this.extensionsRepository.delete(existing.id);
    this.extensionsCache.invalidate(this.namespace);
    this.logger.debug(`Deleted inventory extension for built-in entity type "${type}"`);
  }

  private validateDefinition(candidate: EntityDefinitionWithoutId): EntityDefinitionWithoutId {
    assertRegistrableDefinition(candidate, { reservedTypes: this.codeDefinitions });
    // Store the mode explicitly so readers never have to know that "absent" means "none".
    return { ...candidate, materialisation: { mode: 'none' } };
  }

  /** Registration rules plus "code wins": a code-registered extension cannot be overridden by the API. */
  private validateExtension(document: BuiltInInventoryExtensionDocument): BuiltInEntityType {
    const type = assertRegistrableExtension(document);
    if (this.builtInInventoryExtensions.has(type)) {
      throw new InventoryExtensionCodeRegisteredError(type);
    }
    return type;
  }

  /** Bypasses the cache: writes must see the latest persisted state. */
  private findStored(type: string): Promise<StoredEntityDefinition | undefined> {
    return this.repository.findByType(type);
  }

  private findStoredExtension(type: string): Promise<StoredInventoryExtension | undefined> {
    return this.extensionsRepository.findByType(type);
  }
}

const extensionRecord = (
  { type, document, createdAt, updatedAt }: StoredInventoryExtensionAttributes,
  namespace: string
): EntityDefinitionRecord => {
  // The stored `type` was validated as a built-in before the write.
  if (!isBuiltInEntityType(type)) {
    throw new EntityDefinitionValidationError(`"${type}" is not a built-in entity type`);
  }
  return builtInRecord(type, namespace, {
    inventory: document.inventory,
    source: 'api',
    createdAt,
    updatedAt,
  });
};

/** `identityField` is the single identity declaration; anything else may change freely. */
const identityChanged = (
  before: EntityDefinitionWithoutId,
  after: EntityDefinitionWithoutId
): boolean => !isEqual(before.identityField, after.identityField);

function assertNotReserved(type: string, codeDefinitions: CodeDefinitionsRegistry): void {
  assertRegistrableDefinition(
    // Only the type name matters for the reserved-name checks.
    { type, name: type, identityField: { singleField: type } },
    { reservedTypes: codeDefinitions }
  );
}
