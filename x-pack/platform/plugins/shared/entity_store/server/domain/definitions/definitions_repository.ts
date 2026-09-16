/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { ENTITY_DEFINITION_SAVED_OBJECT_TYPE } from '../../../common';
import {
  getEntityDefinitionSavedObjectId,
  type StoredEntityDefinitionAttributes,
} from './saved_object';
import {
  TypedSavedObjectsRepository,
  type EntityDefinitionsSavedObjectsClient,
  type StoredObject,
} from './typed_saved_objects_repository';

export {
  MAX_DEFINITIONS_PER_SPACE,
  type EntityDefinitionsSavedObjectsClient,
  type StoredObject,
} from './typed_saved_objects_repository';

/** A persisted definition with the saved object id it lives under. */
export type StoredEntityDefinition = StoredObject<StoredEntityDefinitionAttributes>;

/** Dynamic (API-registered) definitions of one space. */
export class EntityDefinitionsRepository extends TypedSavedObjectsRepository<StoredEntityDefinitionAttributes> {
  constructor(soClient: EntityDefinitionsSavedObjectsClient, namespace: string) {
    super(soClient, namespace, {
      savedObjectType: ENTITY_DEFINITION_SAVED_OBJECT_TYPE,
      getId: getEntityDefinitionSavedObjectId,
    });
  }
}
