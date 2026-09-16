/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { isEqual } from 'lodash';
import type { Logger } from '@kbn/logging';
import type { EntityDefinitionWithoutId } from '../../../common/domain/definitions/entity_schema';
import { getInventoryIdentity } from '../../../common/domain/definitions/entity_schema';
import type { EntityDefinitionRecord } from '../../../common/domain/definitions/definition_record';
import type { EntityDefinitionsCache } from './definitions_cache';
import {
  MAX_DEFINITIONS_PER_SPACE,
  type EntityDefinitionsRepository,
  type StoredEntityDefinition,
} from './definitions_repository';
import {
  EntityDefinitionAlreadyExistsError,
  EntityDefinitionIdentityChangedError,
  EntityDefinitionNotFoundError,
  EntityDefinitionValidationError,
} from './errors';
import type { CodeDefinitionsRegistry } from './code_definitions_registry';
import { assertRegistrableDefinition, parseDefinitionInput } from './registration_rules';
import { apiRecord } from './registry';

export interface ReplaceDefinitionOptions {
  /** Allow a replace that changes the identity (and therefore every derived entity id). */
  force?: boolean;
}

interface EntityDefinitionsClientDeps {
  repository: EntityDefinitionsRepository;
  cache: EntityDefinitionsCache;
  codeDefinitions: CodeDefinitionsRegistry;
  namespace: string;
  logger: Logger;
  now?: () => Date;
}

/**
 * Write side of dynamic (API) definitions for one space. Must be built over a request-scoped saved
 * objects client so saved-object authorization and the request's space apply.
 */
export class EntityDefinitionsClient {
  private readonly repository: EntityDefinitionsRepository;
  private readonly cache: EntityDefinitionsCache;
  private readonly codeDefinitions: CodeDefinitionsRegistry;
  private readonly namespace: string;
  private readonly logger: Logger;
  private readonly now: () => Date;

  constructor({
    repository,
    cache,
    codeDefinitions,
    namespace,
    logger,
    now = () => new Date(),
  }: EntityDefinitionsClientDeps) {
    this.repository = repository;
    this.cache = cache;
    this.codeDefinitions = codeDefinitions;
    this.namespace = namespace;
    this.logger = logger;
    this.now = now;
  }

  async create(candidate: unknown): Promise<EntityDefinitionRecord> {
    const definition = this.validate(candidate);
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

  async replace(
    type: string,
    candidate: unknown,
    { force = false }: ReplaceDefinitionOptions = {}
  ): Promise<EntityDefinitionRecord> {
    const definition = this.validate(candidate);
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

  async delete(type: string): Promise<void> {
    assertNotReserved(type, this.codeDefinitions);
    const existing = await this.findStored(type);
    if (!existing) {
      throw new EntityDefinitionNotFoundError(type, this.namespace);
    }
    await this.repository.delete(existing.id);
    this.cache.invalidate(this.namespace);
    this.logger.debug(`Deleted entity definition "${type}"`);
  }

  private validate(candidate: unknown): EntityDefinitionWithoutId {
    const definition = parseDefinitionInput(candidate);
    assertRegistrableDefinition(definition, { reservedTypes: this.codeDefinitions });
    // Store the mode explicitly so readers never have to know that "absent" means "none".
    return { ...definition, materialisation: { mode: 'none' } };
  }

  /** Bypasses the cache: writes must see the latest persisted state. */
  private findStored(type: string): Promise<StoredEntityDefinition | undefined> {
    return this.repository.findByType(type);
  }
}

/** The identity core is `identityField` (and its authoring form `inventory.identity`). */
const identityChanged = (
  before: EntityDefinitionWithoutId,
  after: EntityDefinitionWithoutId
): boolean =>
  !isEqual(before.identityField, after.identityField) ||
  !isEqual(getInventoryIdentity(before), getInventoryIdentity(after));

function assertNotReserved(type: string, codeDefinitions: CodeDefinitionsRegistry): void {
  assertRegistrableDefinition(
    // Only the type name matters for the reserved-name checks.
    { type, name: type, identityField: { singleField: type } },
    { reservedTypes: codeDefinitions }
  );
}
