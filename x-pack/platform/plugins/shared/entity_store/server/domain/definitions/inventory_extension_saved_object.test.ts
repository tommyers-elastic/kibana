/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { SavedObject } from '@kbn/core/server';
import {
  ENTITY_DEFINITION_SAVED_OBJECT_TYPE,
  ENTITY_INVENTORY_EXTENSION_SAVED_OBJECT_TYPE,
} from '../../../common';
import {
  createInventoryExtensionSavedObjectType,
  getInventoryExtensionImportWarnings,
  getInventoryExtensionSavedObjectId,
  validateStoredInventoryExtension,
  type StoredInventoryExtensionAttributes,
} from './inventory_extension_saved_object';
import { createEntityDefinitionSavedObjectType } from './saved_object';

const codeExtensions = { has: (type: string) => type === 'user' };

const stored = (
  document: StoredInventoryExtensionAttributes['document'],
  type = document.extends
): StoredInventoryExtensionAttributes => ({
  type,
  createdAt: '2026-09-16T00:00:00.000Z',
  updatedAt: '2026-09-16T00:00:00.000Z',
  document,
});

const hostDocument = {
  extends: 'host',
  inventory: { label: 'Hosts', sources: [{ index: 'metrics-system.cpu-*' }] },
};

const asSavedObject = (
  attributes: StoredInventoryExtensionAttributes
): SavedObject<StoredInventoryExtensionAttributes> => ({
  id: `imported-${attributes.type}`,
  type: ENTITY_INVENTORY_EXTENSION_SAVED_OBJECT_TYPE,
  attributes,
  references: [],
});

describe('validateStoredInventoryExtension', () => {
  it('accepts a well-formed extension of a built-in whose type attribute matches', () => {
    expect(validateStoredInventoryExtension(stored(hostDocument), codeExtensions)).toBeUndefined();
  });

  it('rejects an extends that is not built-in', () => {
    expect(
      validateStoredInventoryExtension(
        stored({ ...hostDocument, extends: 'k8s.pod' }),
        codeExtensions
      )
    ).toMatch(/not a built-in entity type/);
  });

  it('rejects a type attribute that disagrees with extends', () => {
    expect(
      validateStoredInventoryExtension(stored(hostDocument, 'service'), codeExtensions)
    ).toMatch(/"type" attribute \("service"\) does not match the extended type \("host"\)/);
  });

  it('rejects an extension shadowed by a code-registered one', () => {
    expect(
      validateStoredInventoryExtension(
        stored({ extends: 'user', inventory: { sources: [{ index: 'logs-*' }] } }),
        codeExtensions
      )
    ).toMatch(/registered in code, which takes precedence/);
  });

  it('rejects identity-field attributes and schema failures', () => {
    expect(
      validateStoredInventoryExtension(
        stored({
          extends: 'host',
          inventory: { ...hostDocument.inventory, attributes: ['host.id'] },
        }),
        codeExtensions
      )
    ).toMatch(/attribute "host.id" is an identity field/);
    expect(
      validateStoredInventoryExtension(
        stored({ extends: 'host', inventory: { sources: [] } }),
        codeExtensions
      )
    ).toMatch(/Invalid inventory extension document: inventory.sources/);
  });
});

describe('getInventoryExtensionImportWarnings', () => {
  it('warns once per invalid object and stays silent for valid ones', () => {
    const warnings = getInventoryExtensionImportWarnings(
      [
        asSavedObject(stored(hostDocument)),
        asSavedObject(stored({ ...hostDocument, extends: 'k8s.pod' })),
      ],
      codeExtensions
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ type: 'simple' });
    expect(warnings[0].message).toContain('"k8s.pod"');
    expect(warnings[0].message).toContain('not a built-in entity type');
  });
});

describe('createInventoryExtensionSavedObjectType', () => {
  const type = createInventoryExtensionSavedObjectType(codeExtensions);
  const definitionType = createEntityDefinitionSavedObjectType(codeExtensions);

  it('mirrors the definitions type settings under its own name and indexes only type', () => {
    expect(type.name).toBe(ENTITY_INVENTORY_EXTENSION_SAVED_OBJECT_TYPE);
    expect(type.name).not.toBe(ENTITY_DEFINITION_SAVED_OBJECT_TYPE);
    expect(type.namespaceType).toBe(definitionType.namespaceType);
    expect(type.hidden).toBe(definitionType.hidden);
    expect(type.hiddenFromHttpApis).toBe(definitionType.hiddenFromHttpApis);
    expect(type.management?.importableAndExportable).toBe(true);
    expect(type.management?.visibleInManagement).toBe(true);
    expect(type.mappings).toEqual({ dynamic: false, properties: { type: { type: 'keyword' } } });
    expect(Object.keys(type.modelVersions ?? {})).toEqual(['1']);
  });

  it('titles objects by the extended type and reports import warnings', async () => {
    expect(type.management?.getTitle?.(asSavedObject(stored(hostDocument)))).toBe(
      'Entity inventory extension: host'
    );
    const result = await type.management?.onImport?.([
      asSavedObject(stored({ ...hostDocument, extends: 'k8s.pod' })),
    ]);
    expect(result?.warnings).toHaveLength(1);
  });

  it('derives a deterministic id per type and space', () => {
    expect(getInventoryExtensionSavedObjectId('host', 'default')).toBe(
      `${ENTITY_INVENTORY_EXTENSION_SAVED_OBJECT_TYPE}-host-default`
    );
  });

  it('validates created attributes with the model version schema', () => {
    const versions = type.modelVersions;
    expect(typeof versions).toBe('object');
    const create = typeof versions === 'object' ? versions[1]?.schemas?.create : undefined;
    expect(create).toBeDefined();
    expect(() => create?.validate(stored(hostDocument))).not.toThrow();
    expect(() => create?.validate({ type: 'host' })).toThrow();
  });
});
