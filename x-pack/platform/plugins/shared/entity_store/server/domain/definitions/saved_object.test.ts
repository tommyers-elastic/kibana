/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { SavedObject } from '@kbn/core/server';
import {
  k8sNodeInventoryDefinition,
  k8sPodInventoryDefinition,
} from '../../../common/domain/definitions/__fixtures__/inventory_definitions';
import { hostEntityDefinition } from '../../../common/domain/definitions/host';
import { ENTITY_DEFINITION_SAVED_OBJECT_TYPE } from '../../../common';
import {
  createEntityDefinitionSavedObjectType,
  getEntityDefinitionImportWarnings,
  validateStoredEntityDefinition,
  type StoredEntityDefinitionAttributes,
} from './saved_object';

const reserved = { has: (type: string) => type === 'k8s.node' };

const stored = (
  definition: StoredEntityDefinitionAttributes['definition'],
  overrides: Partial<StoredEntityDefinitionAttributes> = {}
): StoredEntityDefinitionAttributes => ({
  type: definition.type,
  version: 1,
  createdAt: '2026-09-16T00:00:00.000Z',
  updatedAt: '2026-09-16T00:00:00.000Z',
  definition,
  ...overrides,
});

const asSavedObject = (
  attributes: StoredEntityDefinitionAttributes
): SavedObject<StoredEntityDefinitionAttributes> => ({
  id: `imported-${attributes.type}`,
  type: ENTITY_DEFINITION_SAVED_OBJECT_TYPE,
  attributes,
  references: [],
});

describe('validateStoredEntityDefinition', () => {
  it('accepts a well-formed, non-materialised definition whose type attribute matches', () => {
    expect(validateStoredEntityDefinition(stored(k8sPodInventoryDefinition), reserved)).toBe(
      undefined
    );
  });

  it('rejects a built-in or code-registered type name', () => {
    expect(
      validateStoredEntityDefinition(
        stored({ type: 'host', name: 'h', identityField: { singleField: 'host.name' } }),
        reserved
      )
    ).toMatch(/built-in entity type/);
    expect(validateStoredEntityDefinition(stored(k8sNodeInventoryDefinition), reserved)).toMatch(
      /registered in code/
    );
  });

  it('rejects a materialised definition and a schema violation', () => {
    expect(
      validateStoredEntityDefinition(
        stored({ ...hostEntityDefinition, type: 'host.copy' }),
        reserved
      )
    ).toMatch(/materialisation.mode must be "none"/);
    expect(
      validateStoredEntityDefinition(
        stored({ type: 'Bad Type', name: 'x', identityField: { singleField: 'a' } }),
        reserved
      )
    ).toMatch(/Invalid entity definition: type/);
  });

  it('rejects a type attribute that disagrees with the body', () => {
    expect(
      validateStoredEntityDefinition(
        stored(k8sPodInventoryDefinition, { type: 'k8s.something' }),
        reserved
      )
    ).toMatch(/does not match the definition type/);
  });
});

describe('entity definition saved object type', () => {
  const soType = createEntityDefinitionSavedObjectType(reserved);

  it('is visible, importable and exportable in management but closed to the generic HTTP API', () => {
    expect(soType.hiddenFromHttpApis).toBe(true);
    expect(soType.management).toMatchObject({
      importableAndExportable: true,
      visibleInManagement: true,
      defaultSearchField: 'type',
    });
    expect(soType.management?.getTitle?.(asSavedObject(stored(k8sPodInventoryDefinition)))).toBe(
      'Entity definition: k8s.pod (v1)'
    );
  });

  it('warns about imported objects that the registry will ignore', () => {
    const warnings = getEntityDefinitionImportWarnings(
      [
        asSavedObject(stored(k8sPodInventoryDefinition)),
        asSavedObject(stored({ ...hostEntityDefinition, type: 'host.copy' })),
      ],
      reserved
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ type: 'simple' });
    expect(warnings[0].message).toContain('"host.copy"');
    expect(warnings[0].message).toContain('materialisation.mode must be "none"');

    expect(
      soType.management?.onImport?.([asSavedObject(stored(k8sPodInventoryDefinition))])
    ).toEqual({
      warnings: [],
    });
  });
});
