/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { SavedObjectsFindResponse } from '@kbn/core-saved-objects-api-server';
import { savedObjectsClientMock } from '@kbn/core/server/mocks';
import {
  k8sDeploymentInventoryDefinition,
  k8sNodeInventoryDefinition,
  k8sPodInventoryDefinition,
} from '../../../common/domain/definitions/__fixtures__/inventory_definitions';
import { ALL_BUILT_IN_ENTITY_TYPES } from '../../../common/domain/definitions/built_in_entity_types';
import { hostEntityDefinition } from '../../../common/domain/definitions/host';
import { ENTITY_DEFINITION_SAVED_OBJECT_TYPE } from '../../../common';
import { EntityDefinitionsCache } from './definitions_cache';
import { EntityDefinitionsRepository } from './definitions_repository';
import { EntityDefinitionValidationError } from './errors';
import { CodeDefinitionsRegistry } from './code_definitions_registry';
import { EntityDefinitionRegistry } from './registry';
import type { StoredEntityDefinitionAttributes } from './saved_object';

const NAMESPACE = 'space-a';

const stored = (
  definition: StoredEntityDefinitionAttributes['definition'],
  version = 1
): StoredEntityDefinitionAttributes => ({
  type: definition.type,
  version,
  createdAt: '2026-09-15T00:00:00.000Z',
  updatedAt: '2026-09-15T00:00:00.000Z',
  definition,
});

describe('CodeDefinitionsRegistry', () => {
  it('registers a valid non-materialised definition', () => {
    const registry = new CodeDefinitionsRegistry();
    registry.register(k8sPodInventoryDefinition);
    expect(registry.has('k8s.pod')).toBe(true);
    expect(registry.get('k8s.pod')?.type).toBe('k8s.pod');
    expect(registry.values()).toHaveLength(1);
  });

  it('rejects a built-in type name', () => {
    const registry = new CodeDefinitionsRegistry();
    expect(() =>
      registry.register({ type: 'host', name: 'x', identityField: { singleField: 'host.name' } })
    ).toThrow(EntityDefinitionValidationError);
  });

  it('rejects a duplicate registration', () => {
    const registry = new CodeDefinitionsRegistry();
    registry.register(k8sPodInventoryDefinition);
    expect(() => registry.register(k8sPodInventoryDefinition)).toThrow(/registered in code/);
  });

  it('rejects a materialised definition', () => {
    const registry = new CodeDefinitionsRegistry();
    const { id: _id, ...hostWithoutId } = { id: 'x', ...hostEntityDefinition };
    expect(() => registry.register({ ...hostWithoutId, type: 'host.copy' })).toThrow(
      /materialisation.mode must be "none"/
    );
  });

  it('rejects a definition that fails the schema', () => {
    const registry = new CodeDefinitionsRegistry();
    expect(() =>
      registry.register({
        type: 'Bad Type',
        name: 'x',
        identityField: { singleField: 'a' },
      })
    ).toThrow(/Invalid entity definition: type/);
  });
});

describe('EntityDefinitionRegistry', () => {
  let soClient: ReturnType<typeof savedObjectsClientMock.create>;
  let cache: EntityDefinitionsCache;
  let codeDefinitions: CodeDefinitionsRegistry;
  let now: number;

  const createRegistry = (namespace = NAMESPACE) =>
    new EntityDefinitionRegistry({
      repository: new EntityDefinitionsRepository(soClient, namespace),
      cache,
      codeDefinitions,
      namespace,
    });

  const mockStored = (...definitions: StoredEntityDefinitionAttributes[]) => {
    soClient.find.mockResolvedValue({
      total: definitions.length,
      per_page: 500,
      page: 1,
      saved_objects: definitions.map((attributes) => ({
        id: `${ENTITY_DEFINITION_SAVED_OBJECT_TYPE}-${attributes.type}-${NAMESPACE}`,
        type: ENTITY_DEFINITION_SAVED_OBJECT_TYPE,
        attributes,
        references: [],
        score: 0,
      })),
    } as SavedObjectsFindResponse<StoredEntityDefinitionAttributes>);
  };

  beforeEach(() => {
    soClient = savedObjectsClientMock.create();
    now = 1_000_000;
    cache = new EntityDefinitionsCache(30_000, () => now);
    codeDefinitions = new CodeDefinitionsRegistry();
    mockStored();
  });

  it('resolves built-ins without touching persistence', async () => {
    const record = await createRegistry().getDefinition('host');
    expect(record).toMatchObject({
      source: 'built_in',
      version: 1,
      definition: { type: 'host', id: 'security_host_space-a' },
    });
    expect(soClient.find).not.toHaveBeenCalled();
    expect(createRegistry().isBuiltIn('host')).toBe(true);
    expect(createRegistry().isReserved('host')).toBe(true);
  });

  it('resolves code-registered definitions in every space', async () => {
    codeDefinitions.register(k8sNodeInventoryDefinition);
    const registry = createRegistry();
    expect(registry.isBuiltIn('k8s.node')).toBe(false);
    expect(registry.isReserved('k8s.node')).toBe(true);

    const record = await registry.getDefinition('k8s.node');
    expect(record).toMatchObject({
      source: 'code',
      version: 1,
      definition: { type: 'k8s.node', id: 'registered_k8s.node_space-a' },
    });
    expect((await createRegistry('space-b').getDefinition('k8s.node'))?.definition.id).toBe(
      'registered_k8s.node_space-b'
    );
    expect(soClient.find).not.toHaveBeenCalled();
  });

  it('resolves API-registered definitions from the space, with their version', async () => {
    mockStored(stored(k8sDeploymentInventoryDefinition, 3));
    const record = await createRegistry().getDefinition('k8s.deployment');
    expect(record).toMatchObject({
      source: 'api',
      version: 3,
      createdAt: '2026-09-15T00:00:00.000Z',
      definition: { type: 'k8s.deployment', id: 'registered_k8s.deployment_space-a' },
    });
    expect(soClient.find).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ENTITY_DEFINITION_SAVED_OBJECT_TYPE,
        namespaces: [NAMESPACE],
      })
    );
    expect(await createRegistry().getDefinition('unknown.type')).toBeUndefined();
  });

  it('lists built-ins, code and API definitions and filters by materialisation mode', async () => {
    codeDefinitions.register(k8sNodeInventoryDefinition);
    mockStored(stored(k8sDeploymentInventoryDefinition));
    const registry = createRegistry();

    const all = await registry.getDefinitions();
    expect(all.map(({ definition }) => definition.type)).toEqual([
      ...ALL_BUILT_IN_ENTITY_TYPES,
      'k8s.node',
      'k8s.deployment',
    ]);

    const materialised = await registry.getDefinitions({ mode: 'extraction' });
    expect(materialised.map(({ definition }) => definition.type)).toEqual(
      ALL_BUILT_IN_ENTITY_TYPES
    );

    const live = await registry.getDefinitions({ mode: 'none' });
    expect(live.map(({ definition, source }) => [definition.type, source])).toEqual([
      ['k8s.node', 'code'],
      ['k8s.deployment', 'api'],
    ]);
  });

  it('caches API definitions per space until invalidated or expired', async () => {
    mockStored(stored(k8sDeploymentInventoryDefinition));
    const registry = createRegistry();

    await registry.getDefinition('k8s.deployment');
    await registry.getDefinitions();
    expect(soClient.find).toHaveBeenCalledTimes(1);

    // Another space is loaded separately.
    await createRegistry('space-b').getDefinitions();
    expect(soClient.find).toHaveBeenCalledTimes(2);

    cache.invalidate(NAMESPACE);
    await registry.getDefinition('k8s.deployment');
    expect(soClient.find).toHaveBeenCalledTimes(3);

    now += 30_001;
    await registry.getDefinition('k8s.deployment');
    expect(soClient.find).toHaveBeenCalledTimes(4);
  });
});
