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
import type { BuiltInInventoryExtensionDocument } from '../../../common/domain/definitions/inventory_schema';
import { ENTITY_INVENTORY_EXTENSION_SAVED_OBJECT_TYPE } from '../../../common';
import { assertRegistrableExtension, parseExtensionDocument } from './registration_rules';
import type { ReservedTypes } from './saved_object';

/**
 * Persisted form of an API-registered (or imported) inventory extension of a built-in type. One
 * saved object per built-in type per space. `type` is the extended type (a copy of
 * `document.extends`) and the only indexed attribute, so the repository lookup stays keyed on
 * `type` like definitions; the document is stored verbatim and unmapped, validated with the zod
 * document schema on every API write and re-validated on read because import bypasses the API.
 */
export interface StoredInventoryExtensionAttributes {
  type: string;
  createdAt: string;
  updatedAt: string;
  document: BuiltInInventoryExtensionDocument;
}

export const getInventoryExtensionSavedObjectId = (type: string, namespace: string): string =>
  `${ENTITY_INVENTORY_EXTENSION_SAVED_OBJECT_TYPE}-${type}-${namespace}`;

/**
 * Applies the extension registration rules to a stored object. Returns the reason it is invalid,
 * or `undefined` when it is a well-formed extension of a built-in type whose `type` attribute
 * matches `document.extends` and that is not shadowed by a code-registered extension.
 */
export function validateStoredInventoryExtension(
  attributes: StoredInventoryExtensionAttributes,
  codeExtensions: ReservedTypes
): string | undefined {
  try {
    const document = parseExtensionDocument(attributes.document);
    const type = assertRegistrableExtension(document);
    if (type !== attributes.type) {
      return `the "type" attribute ("${attributes.type}") does not match the extended type ("${type}")`;
    }
    if (codeExtensions.has(type)) {
      return `an inventory extension for "${type}" is registered in code, which takes precedence`;
    }
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const storedInventoryExtensionSchemaV1 = schema.object({
  type: schema.string({ minLength: 1, maxLength: 128 }),
  createdAt: schema.string(),
  updatedAt: schema.string(),
  // Validated by the zod `builtInInventoryExtensionDocumentSchema` before it is written; stored unmapped.
  document: schema.recordOf(schema.string(), schema.any()),
});

const version1: SavedObjectsFullModelVersion = {
  changes: [],
  schemas: {
    create: storedInventoryExtensionSchemaV1,
    forwardCompatibility: storedInventoryExtensionSchemaV1.extends({}, { unknowns: 'ignore' }),
  },
};

/** Import cannot be rejected by a hook, so invalid objects are imported with a warning and ignored on read. */
export function getInventoryExtensionImportWarnings(
  objects: Array<SavedObject<StoredInventoryExtensionAttributes>>,
  codeExtensions: ReservedTypes
): SavedObjectsImportWarning[] {
  return objects.flatMap(({ attributes }) => {
    const reason = validateStoredInventoryExtension(attributes, codeExtensions);
    if (reason === undefined) {
      return [];
    }
    return [
      {
        type: 'simple' as const,
        message: i18n.translate(
          'entityStore.savedObjects.inventoryExtension.invalidImportWarning',
          {
            defaultMessage:
              'Inventory extension for "{type}" was imported but will be ignored by the entity store: {reason}',
            values: { type: attributes.type, reason },
          }
        ),
      },
    ];
  });
}

/**
 * The saved object type, with the same visibility, import/export and HTTP settings as the
 * definitions type. `codeExtensions` supplies the code-registered extensions for the import warnings.
 */
export function createInventoryExtensionSavedObjectType(
  codeExtensions: ReservedTypes
): SavedObjectsType<StoredInventoryExtensionAttributes> {
  return {
    name: ENTITY_INVENTORY_EXTENSION_SAVED_OBJECT_TYPE,
    hidden: false,
    namespaceType: 'multiple-isolated',
    mappings: {
      dynamic: false,
      properties: {
        type: { type: 'keyword' },
      },
    },
    modelVersions: { 1: version1 },
    hiddenFromHttpApis: true,
    management: {
      importableAndExportable: true,
      visibleInManagement: true,
      defaultSearchField: 'type',
      icon: 'indexSettings',
      displayName: i18n.translate('entityStore.savedObjects.inventoryExtension.displayName', {
        defaultMessage: 'Entity inventory extension',
      }),
      getTitle: ({ attributes }) =>
        i18n.translate('entityStore.savedObjects.inventoryExtension.title', {
          defaultMessage: 'Entity inventory extension: {type}',
          values: { type: attributes.type },
        }),
      onImport: (objects) => ({
        warnings: getInventoryExtensionImportWarnings(objects, codeExtensions),
      }),
    },
  };
}
