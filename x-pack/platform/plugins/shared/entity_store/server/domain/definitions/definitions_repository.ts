/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { SavedObjectsClientContract } from '@kbn/core-saved-objects-api-server';
import { ENTITY_DEFINITION_SAVED_OBJECT_TYPE } from '../../../common';
import {
  getEntityDefinitionSavedObjectId,
  type StoredEntityDefinitionAttributes,
} from './saved_object';

/**
 * Reads work with both a request-scoped saved objects client and an internal repository because
 * they only use `find` with explicit `namespaces`. Writes must go through a request-scoped client
 * (the spaces wrapper derives the namespace from the request and rejects an explicit one).
 */
export type EntityDefinitionsSavedObjectsClient = Pick<
  SavedObjectsClientContract,
  'find' | 'create' | 'update' | 'delete'
>;

/** Upper bound on definitions per space; also the page size of the single `find` that loads them. */
export const MAX_DEFINITIONS_PER_SPACE = 500;

/** A persisted definition with the saved object id it lives under. */
export interface StoredEntityDefinition {
  id: string;
  attributes: StoredEntityDefinitionAttributes;
}

/**
 * Saved-object persistence of dynamic definitions for one space. No caching, no business rules.
 *
 * Objects are located by their `type` attribute, never by a derived id: an object created through
 * this repository gets a deterministic id, but one imported by another installer (e.g. a Fleet
 * package asset) may carry any id and must still be replaceable and deletable.
 */
export class EntityDefinitionsRepository {
  constructor(
    private readonly soClient: EntityDefinitionsSavedObjectsClient,
    private readonly namespace: string
  ) {}

  async findAll(): Promise<StoredEntityDefinition[]> {
    const { saved_objects: savedObjects } =
      await this.soClient.find<StoredEntityDefinitionAttributes>({
        type: ENTITY_DEFINITION_SAVED_OBJECT_TYPE,
        namespaces: [this.namespace],
        perPage: MAX_DEFINITIONS_PER_SPACE,
        sortField: 'type',
        sortOrder: 'asc',
      });
    return savedObjects.map(({ id, attributes }) => ({ id, attributes }));
  }

  async findByType(type: string): Promise<StoredEntityDefinition | undefined> {
    return (await this.findAll()).find(({ attributes }) => attributes.type === type);
  }

  async create(
    attributes: StoredEntityDefinitionAttributes
  ): Promise<StoredEntityDefinitionAttributes> {
    const { attributes: created } = await this.soClient.create<StoredEntityDefinitionAttributes>(
      ENTITY_DEFINITION_SAVED_OBJECT_TYPE,
      attributes,
      { id: getEntityDefinitionSavedObjectId(attributes.type, this.namespace), refresh: 'wait_for' }
    );
    return created;
  }

  /** Full replacement of the stored attributes (no merge), so removed optional keys disappear. */
  async replace(
    id: string,
    attributes: StoredEntityDefinitionAttributes
  ): Promise<StoredEntityDefinitionAttributes> {
    await this.soClient.update<StoredEntityDefinitionAttributes>(
      ENTITY_DEFINITION_SAVED_OBJECT_TYPE,
      id,
      attributes,
      { refresh: 'wait_for', mergeAttributes: false }
    );
    return attributes;
  }

  async delete(id: string): Promise<void> {
    await this.soClient.delete(ENTITY_DEFINITION_SAVED_OBJECT_TYPE, id, { refresh: 'wait_for' });
  }
}
