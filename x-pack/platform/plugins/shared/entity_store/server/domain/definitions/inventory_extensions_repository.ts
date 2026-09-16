/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { ENTITY_INVENTORY_EXTENSION_SAVED_OBJECT_TYPE } from '../../../common';
import {
  getInventoryExtensionSavedObjectId,
  type StoredInventoryExtensionAttributes,
} from './inventory_extension_saved_object';
import {
  TypedSavedObjectsRepository,
  type EntityDefinitionsSavedObjectsClient,
  type StoredObject,
} from './typed_saved_objects_repository';

/** A persisted built-in inventory extension with the saved object id it lives under. */
export type StoredInventoryExtension = StoredObject<StoredInventoryExtensionAttributes>;

/** API-registered inventory extensions of built-in types for one space, keyed by the extended type. */
export class InventoryExtensionsRepository extends TypedSavedObjectsRepository<StoredInventoryExtensionAttributes> {
  constructor(soClient: EntityDefinitionsSavedObjectsClient, namespace: string) {
    super(soClient, namespace, {
      savedObjectType: ENTITY_INVENTORY_EXTENSION_SAVED_OBJECT_TYPE,
      getId: getInventoryExtensionSavedObjectId,
    });
  }
}
