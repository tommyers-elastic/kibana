/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { SavedObjectsFullModelVersion } from '@kbn/core-saved-objects-server';
import type { SavedObjectsType } from '@kbn/core/server';
import { schema } from '@kbn/config-schema';
import type { EntityDefinitionWithoutId } from '../../../common/domain/definitions/entity_schema';
import { ENTITY_DEFINITION_SAVED_OBJECT_TYPE } from '../../../common';

/**
 * Persisted form of a dynamically registered (API) entity definition. One saved object per type
 * per space; the saved object id is derived from both (see `getEntityDefinitionSavedObjectId`).
 *
 * Only `type` is indexed: it is the sole attribute the repository filters on. The definition body
 * is stored unmapped (`dynamic: false`) so its schema can evolve without saved-object mapping
 * changes; it is validated with the zod definition schema on every write.
 */
export interface StoredEntityDefinitionAttributes {
  type: string;
  /** Monotonically increasing per type; bumped on every replace. */
  version: number;
  createdAt: string;
  updatedAt: string;
  definition: EntityDefinitionWithoutId;
}

export const getEntityDefinitionSavedObjectId = (type: string, namespace: string): string =>
  `${ENTITY_DEFINITION_SAVED_OBJECT_TYPE}-${type}-${namespace}`;

const storedEntityDefinitionSchemaV1 = schema.object({
  type: schema.string({ minLength: 1, maxLength: 128 }),
  version: schema.number({ min: 1 }),
  createdAt: schema.string(),
  updatedAt: schema.string(),
  // Validated by the zod `entityDefinitionInputSchema` before it is written; stored unmapped.
  definition: schema.recordOf(schema.string(), schema.any()),
});

const version1: SavedObjectsFullModelVersion = {
  changes: [],
  schemas: {
    create: storedEntityDefinitionSchemaV1,
    forwardCompatibility: storedEntityDefinitionSchemaV1.extends({}, { unknowns: 'ignore' }),
  },
};

export const EntityDefinitionSavedObjectType: SavedObjectsType = {
  name: ENTITY_DEFINITION_SAVED_OBJECT_TYPE,
  hidden: false,
  // Space-scoped, like every other entity store asset: a definition registered in space A is
  // resolvable in A only.
  namespaceType: 'multiple-isolated',
  mappings: {
    dynamic: false,
    properties: {
      type: { type: 'keyword' },
    },
  },
  modelVersions: { 1: version1 },
  hiddenFromHttpApis: true,
};
