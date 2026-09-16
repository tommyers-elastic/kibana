/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { SavedObjectsFindResponse } from '@kbn/core-saved-objects-api-server';
import { savedObjectsClientMock } from '@kbn/core/server/mocks';
import { loggerMock } from '@kbn/logging-mocks';
import {
  k8sDeploymentInventoryDefinition,
  k8sNodeInventoryDefinition,
  k8sPodInventoryDefinition,
} from '../../../common/domain/definitions/__fixtures__/inventory_definitions';
import { ALL_BUILT_IN_ENTITY_TYPES } from '../../../common/domain/definitions/built_in_entity_types';
import { hostEntityDefinition } from '../../../common/domain/definitions/host';
import { getInventoryIdentity } from '../../../common/domain/definitions/entity_schema';
import { getEntityDefinition as getBuiltInEntityDefinition } from '../../../common/domain/definitions/registry';
import { ENTITY_DEFINITION_SAVED_OBJECT_TYPE } from '../../../common';
import { EntityDefinitionsCache } from './definitions_cache';
import { EntityDefinitionsRepository } from './definitions_repository';
import { EntityDefinitionValidationError } from './errors';
import { BuiltInInventoryExtensionsRegistry } from './built_in_inventory_extensions';
import { CodeDefinitionsRegistry } from './code_definitions_registry';
import { EntityDefinitionRegistry } from './registry';
import type { StoredEntityDefinitionAttributes } from './saved_object';

const NAMESPACE = 'space-a';

const stored = (
  definition: StoredEntityDefinitionAttributes['definition']
): StoredEntityDefinitionAttributes => ({
  type: definition.type,
  createdAt: '2026-09-15T00:00:00.000Z',
  updatedAt: '2026-09-15T00:00:00.000Z',
  definition,
});

const hostInventoryExtension = {
  label: 'Hosts',
  attributes: ['host.os.name', 'cloud.provider'],
  sources: [
    {
      index: 'metrics-system.cpu-*',
      metrics: [{ name: 'cpu_pct', field: 'system.cpu.total.norm.pct', agg: 'avg' as const }],
    },
  ],
};

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
  let builtInInventoryExtensions: BuiltInInventoryExtensionsRegistry;
  let now: number;

  const createRegistry = (namespace = NAMESPACE) =>
    new EntityDefinitionRegistry({
      repository: new EntityDefinitionsRepository(soClient, namespace),
      cache,
      codeDefinitions,
      builtInInventoryExtensions,
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
    builtInInventoryExtensions = new BuiltInInventoryExtensionsRegistry();
    mockStored();
  });

  it('resolves built-ins without touching persistence', async () => {
    const record = await createRegistry().getDefinition('host');
    expect(record).toMatchObject({
      source: 'built_in',
      definition: { type: 'host', id: 'security_host_space-a' },
    });
    expect(record?.definition.inventory).toBeUndefined();
    expect(record?.definition).toEqual(getBuiltInEntityDefinition('host', NAMESPACE));
    expect(soClient.find).not.toHaveBeenCalled();
    expect(createRegistry().isBuiltIn('host')).toBe(true);
    expect(createRegistry().isReserved('host')).toBe(true);
  });

  it('serves a built-in with its registered inventory extension without changing its identity or materialisation', async () => {
    builtInInventoryExtensions.register('host', hostInventoryExtension);
    const registry = createRegistry();

    const host = await registry.getDefinition('host');
    const builtIn = getBuiltInEntityDefinition('host', NAMESPACE);
    expect(host).toEqual({
      source: 'built_in',
      definition: { ...builtIn, inventory: hostInventoryExtension },
    });
    expect(host?.definition.identityField).toBe(builtIn.identityField);
    expect(host?.definition.materialisation).toBe(builtIn.materialisation);
    expect(getInventoryIdentity(host!.definition)).toBeUndefined();

    // The other built-ins and the static registry are untouched.
    expect((await registry.getDefinition('user'))?.definition.inventory).toBeUndefined();
    expect(getBuiltInEntityDefinition('host', NAMESPACE).inventory).toBeUndefined();
    expect(soClient.find).not.toHaveBeenCalled();
  });

  it('lists only definitions with an inventory extension when asked', async () => {
    builtInInventoryExtensions.register('host', hostInventoryExtension);
    codeDefinitions.register(k8sNodeInventoryDefinition);
    codeDefinitions.register({
      type: 'plain.code',
      name: 'code definition without inventory',
      identityField: { singleField: 'plain.id' },
    });
    mockStored(
      stored(k8sDeploymentInventoryDefinition),
      stored({
        type: 'plain.api',
        name: 'API definition without inventory',
        identityField: { singleField: 'plain.id' },
      })
    );
    const registry = createRegistry();

    const withInventory = await registry.getDefinitions({ inventory: true });
    expect(withInventory.map(({ definition, source }) => [definition.type, source])).toEqual([
      ['host', 'built_in'],
      ['k8s.node', 'code'],
      ['k8s.deployment', 'api'],
    ]);

    const liveWithInventory = await registry.getDefinitions({ inventory: true, mode: 'none' });
    expect(liveWithInventory.map(({ definition }) => definition.type)).toEqual([
      'k8s.node',
      'k8s.deployment',
    ]);

    // `inventory: false` and omitting it behave alike; the `mode` filter is unchanged.
    expect(await registry.getDefinitions({ inventory: false })).toEqual(
      await registry.getDefinitions()
    );
    expect(
      (await registry.getDefinitions({ mode: 'extraction' })).map(
        ({ definition }) => definition.type
      )
    ).toEqual(ALL_BUILT_IN_ENTITY_TYPES);
    expect((await registry.getDefinitions()).map(({ definition }) => definition.type)).toEqual([
      ...ALL_BUILT_IN_ENTITY_TYPES,
      'k8s.node',
      'plain.code',
      'k8s.deployment',
      'plain.api',
    ]);
  });

  it('resolves code-registered definitions in every space', async () => {
    codeDefinitions.register(k8sNodeInventoryDefinition);
    const registry = createRegistry();
    expect(registry.isBuiltIn('k8s.node')).toBe(false);
    expect(registry.isReserved('k8s.node')).toBe(true);

    const record = await registry.getDefinition('k8s.node');
    expect(record).toMatchObject({
      source: 'code',
      definition: { type: 'k8s.node', id: 'registered_k8s.node_space-a' },
    });
    expect((await createRegistry('space-b').getDefinition('k8s.node'))?.definition.id).toBe(
      'registered_k8s.node_space-b'
    );
    expect(soClient.find).not.toHaveBeenCalled();
  });

  it('resolves API-registered definitions from the space, with their timestamps', async () => {
    mockStored(stored(k8sDeploymentInventoryDefinition));
    const record = await createRegistry().getDefinition('k8s.deployment');
    expect(record).toMatchObject({
      source: 'api',
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

describe('EntityDefinitionRegistry with imported objects', () => {
  it('ignores stored definitions that fail the registration rules and logs why', async () => {
    const soClient = savedObjectsClientMock.create();
    const logger = loggerMock.create();
    const codeDefinitions = new CodeDefinitionsRegistry();
    codeDefinitions.register(k8sNodeInventoryDefinition);
    const valid = stored(k8sDeploymentInventoryDefinition);
    const shadowsCode = stored(k8sNodeInventoryDefinition);
    const materialised = stored({ ...hostEntityDefinition, type: 'host.copy' });
    soClient.find.mockResolvedValue({
      total: 3,
      per_page: 500,
      page: 1,
      saved_objects: [valid, shadowsCode, materialised].map((attributes) => ({
        id: `imported-${attributes.type}`,
        type: ENTITY_DEFINITION_SAVED_OBJECT_TYPE,
        attributes,
        references: [],
        score: 0,
      })),
    } as SavedObjectsFindResponse<StoredEntityDefinitionAttributes>);

    const registry = new EntityDefinitionRegistry({
      repository: new EntityDefinitionsRepository(soClient, NAMESPACE),
      cache: new EntityDefinitionsCache(),
      codeDefinitions,
      builtInInventoryExtensions: new BuiltInInventoryExtensionsRegistry(),
      namespace: NAMESPACE,
      logger,
    });

    const live = await registry.getDefinitions({ mode: 'none' });
    expect(live.map(({ definition, source }) => [definition.type, source])).toEqual([
      ['k8s.node', 'code'],
      ['k8s.deployment', 'api'],
    ]);
    expect(await registry.getDefinition('host.copy')).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('imported-host.copy'));
  });
});
