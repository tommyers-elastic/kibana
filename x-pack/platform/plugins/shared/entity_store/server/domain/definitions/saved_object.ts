/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { SavedObjectsFullModelVersion } from '@kbn/core-saved-objects-server';
import type { SavedObject, SavedObjectsImportWarning, SavedObjectsType } from '@kbn/core/server';
import { schema } from '@kbn/config-schema';
import { i18n } from '@kbn/i18n';
import type { EntityDefinitionWithoutId } from '../../../common/domain/definitions/entity_schema';
import { ENTITY_DEFINITION_SAVED_OBJECT_TYPE } from '../../../common';
import { assertRegistrableDefinition, parseDefinitionInput } from './registration_rules';

/**
 * Persisted form of a dynamically registered (API or imported) entity definition. One saved object
 * per type per space; objects created through the API get a deterministic id (see
 * `getEntityDefinitionSavedObjectId`), imported ones may carry any id.
 *
 * Only `type` is indexed: it is the sole attribute the repository filters on. The definition body
 * is stored unmapped (`dynamic: false`) so its schema can evolve without saved-object mapping
 * changes; it is validated with the zod definition schema on every API write and re-validated on
 * read (see `validateStoredEntityDefinition`) because import bypasses the API.
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

/** Names that cannot be (re)defined by a stored definition: the built-ins plus code-registered types. */
export interface ReservedTypes {
  has(type: string): boolean;
}

/**
 * Applies the registration rules to a stored object, which may have arrived through the saved
 * objects import API rather than the definitions API. Returns the reason it is invalid, or
 * `undefined` when it is a well-formed, registrable, non-materialised definition whose `type`
 * attribute matches its body.
 */
export function validateStoredEntityDefinition(
  attributes: StoredEntityDefinitionAttributes,
  reservedTypes: ReservedTypes
): string | undefined {
  try {
    const definition = parseDefinitionInput(attributes.definition);
    assertRegistrableDefinition(definition, { reservedTypes });
    if (definition.type !== attributes.type) {
      return `the "type" attribute ("${attributes.type}") does not match the definition type ("${definition.type}")`;
    }
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

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

/**
 * Import cannot be rejected by a hook, so invalid objects are imported but reported as warnings
 * here and ignored by the registry on read.
 */
export function getEntityDefinitionImportWarnings(
  objects: Array<SavedObject<StoredEntityDefinitionAttributes>>,
  reservedTypes: ReservedTypes
): SavedObjectsImportWarning[] {
  return objects.flatMap(({ attributes }) => {
    const reason = validateStoredEntityDefinition(attributes, reservedTypes);
    if (reason === undefined) {
      return [];
    }
    return [
      {
        type: 'simple' as const,
        message: i18n.translate('entityStore.savedObjects.entityDefinition.invalidImportWarning', {
          defaultMessage:
            'Entity definition "{type}" was imported but will be ignored by the entity store: {reason}',
          values: { type: attributes.type, reason },
        }),
      },
    ];
  });
}

/**
 * The saved object type. Visible, importable and exportable in Saved Objects management so
 * definitions can be inspected and moved between spaces or deployments (the path a Fleet-shipped
 * definition would also take). `reservedTypes` supplies the code-registered names for the import
 * warnings; the built-ins are always reserved.
 */
export function createEntityDefinitionSavedObjectType(
  reservedTypes: ReservedTypes
): SavedObjectsType<StoredEntityDefinitionAttributes> {
  return {
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
    // Writes go through the definitions API (registration rules, versioning); the generic
    // saved objects HTTP API stays closed. Import/export remain available through management.
    hiddenFromHttpApis: true,
    management: {
      importableAndExportable: true,
      visibleInManagement: true,
      defaultSearchField: 'type',
      icon: 'indexMapping',
      displayName: i18n.translate('entityStore.savedObjects.entityDefinition.displayName', {
        defaultMessage: 'Entity definition',
      }),
      getTitle: ({ attributes }) =>
        i18n.translate('entityStore.savedObjects.entityDefinition.title', {
          defaultMessage: 'Entity definition: {type} (v{version})',
          values: { type: attributes.type, version: attributes.version },
        }),
      onImport: (objects) => ({
        warnings: getEntityDefinitionImportWarnings(objects, reservedTypes),
      }),
    },
  };
}
