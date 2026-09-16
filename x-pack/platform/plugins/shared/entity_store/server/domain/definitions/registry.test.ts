/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type {
  SavedObjectsFindOptions,
  SavedObjectsFindResponse,
} from '@kbn/core-saved-objects-api-server';
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
import {
  ENTITY_DEFINITION_SAVED_OBJECT_TYPE,
  ENTITY_INVENTORY_EXTENSION_SAVED_OBJECT_TYPE,
} from '../../../common';
import { EntityDefinitionsCache } from './definitions_cache';
import { EntityDefinitionsRepository } from './definitions_repository';
import { InventoryExtensionsRepository } from './inventory_extensions_repository';
import { EntityDefinitionValidationError } from './errors';
import { BuiltInInventoryExtensionsRegistry } from './built_in_inventory_extensions';
import { CodeDefinitionsRegistry } from './code_definitions_registry';
import type { StoredInventoryExtensionAttributes } from './inventory_extension_saved_object';
import { EntityDefinitionRegistry } from './registry';
import type { StoredEntityDefinitionAttributes } from './saved_object';

const NAMESPACE = 'space-a';
const T0 = '2026-09-15T00:00:00.000Z';

const stored = (
  definition: StoredEntityDefinitionAttributes['definition']
): StoredEntityDefinitionAttributes => ({
  type: definition.type,
  createdAt: T0,
  updatedAt: T0,
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
const hostExtensionDocument = { extends: 'host', inventory: hostInventoryExtension };

const storedExtension = (
  document: StoredInventoryExtensionAttributes['document'],
  type = document.extends
): StoredInventoryExtensionAttributes => ({
  type,
  createdAt: T0,
  updatedAt: T0,
  document,
});

interface MockedObjects {
  definitions?: StoredEntityDefinitionAttributes[];
  extensions?: StoredInventoryExtensionAttributes[];
}

/**
 * `find` serves both saved object types from one mock, dispatching on the requested type; the
 * objects live in `NAMESPACE` only, so other spaces see nothing.
 */
const mockFind = (
  soClient: ReturnType<typeof savedObjectsClientMock.create>,
  { definitions = [], extensions = [] }: MockedObjects = {}
) => {
  soClient.find.mockImplementation(async ({ type, namespaces }: SavedObjectsFindOptions) => {
    const inSpace = namespaces?.includes(NAMESPACE) ?? false;
    const objects: Array<StoredEntityDefinitionAttributes | StoredInventoryExtensionAttributes> =
      !inSpace ? [] : type === ENTITY_DEFINITION_SAVED_OBJECT_TYPE ? definitions : extensions;
    return {
      total: objects.length,
      per_page: 500,
      page: 1,
      saved_objects: objects.map((attributes) => ({
        id: `${type}-${attributes.type}-${NAMESPACE}`,
        type: type as string,
        attributes,
        references: [],
        score: 0,
      })),
    } as SavedObjectsFindResponse;
  });
};

const findCalls = (
  soClient: ReturnType<typeof savedObjectsClientMock.create>,
  savedObjectType: string
): number =>
  soClient.find.mock.calls.filter(([options]) => options.type === savedObjectType).length;

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
  let extensionsCache: EntityDefinitionsCache<StoredInventoryExtensionAttributes>;
  let codeDefinitions: CodeDefinitionsRegistry;
  let builtInInventoryExtensions: BuiltInInventoryExtensionsRegistry;
  let now: number;

  const createRegistry = (namespace = NAMESPACE) =>
    new EntityDefinitionRegistry({
      repository: new EntityDefinitionsRepository(soClient, namespace),
      cache,
      codeDefinitions,
      extensionsRepository: new InventoryExtensionsRepository(soClient, namespace),
      extensionsCache,
      builtInInventoryExtensions,
      namespace,
    });

  beforeEach(() => {
    soClient = savedObjectsClientMock.create();
    now = 1_000_000;
    cache = new EntityDefinitionsCache(30_000, () => now);
    extensionsCache = new EntityDefinitionsCache(30_000, () => now);
    codeDefinitions = new CodeDefinitionsRegistry();
    builtInInventoryExtensions = new BuiltInInventoryExtensionsRegistry();
    mockFind(soClient);
  });

  it('resolves built-ins without touching the definitions store', async () => {
    const record = await createRegistry().getDefinition('host');
    expect(record).toEqual({
      source: 'built_in',
      definition: getBuiltInEntityDefinition('host', NAMESPACE),
    });
    expect(record?.definition.inventory).toBeUndefined();
    expect(record?.inventorySource).toBeUndefined();
    expect(findCalls(soClient, ENTITY_DEFINITION_SAVED_OBJECT_TYPE)).toBe(0);
    expect(findCalls(soClient, ENTITY_INVENTORY_EXTENSION_SAVED_OBJECT_TYPE)).toBe(1);
    expect(createRegistry().isBuiltIn('host')).toBe(true);
    expect(createRegistry().isReserved('host')).toBe(true);
  });

  it('serves a built-in with its code-registered extension without touching persistence', async () => {
    builtInInventoryExtensions.register(hostExtensionDocument);
    const registry = createRegistry();

    const host = await registry.getDefinition('host');
    const builtIn = getBuiltInEntityDefinition('host', NAMESPACE);
    expect(host).toEqual({
      source: 'built_in',
      inventorySource: 'code',
      definition: { ...builtIn, inventory: hostInventoryExtension },
    });
    expect(host?.definition.identityField).toBe(builtIn.identityField);
    expect(host?.definition.materialisation).toBe(builtIn.materialisation);
    expect(getInventoryIdentity(host!.definition)).toBeUndefined();
    expect(await registry.getInventoryExtension('host')).toEqual({
      inventory: hostInventoryExtension,
      source: 'code',
    });

    // The other built-ins and the static registry are untouched.
    expect((await registry.getDefinition('user'))?.definition.inventory).toBeUndefined();
    expect(getBuiltInEntityDefinition('host', NAMESPACE).inventory).toBeUndefined();
    expect(soClient.find).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: ENTITY_DEFINITION_SAVED_OBJECT_TYPE })
    );
  });

  it('serves a built-in with the API extension stored in its space, with timestamps', async () => {
    mockFind(soClient, { extensions: [storedExtension(hostExtensionDocument)] });
    const registry = createRegistry();

    const host = await registry.getDefinition('host');
    expect(host).toEqual({
      source: 'built_in',
      inventorySource: 'api',
      createdAt: T0,
      updatedAt: T0,
      definition: {
        ...getBuiltInEntityDefinition('host', NAMESPACE),
        inventory: hostInventoryExtension,
      },
    });
    expect(await registry.getInventoryExtension('host')).toEqual({
      inventory: hostInventoryExtension,
      source: 'api',
      createdAt: T0,
      updatedAt: T0,
    });
    expect(soClient.find).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ENTITY_INVENTORY_EXTENSION_SAVED_OBJECT_TYPE,
        namespaces: [NAMESPACE],
      })
    );

    // Another space does not see it.
    const other = await createRegistry('space-b').getDefinition('host');
    expect(other?.definition.inventory).toBeUndefined();
    expect(other?.inventorySource).toBeUndefined();
    expect(soClient.find).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ENTITY_INVENTORY_EXTENSION_SAVED_OBJECT_TYPE,
        namespaces: ['space-b'],
      })
    );
  });

  it('lets a code-registered extension win over a stored one', async () => {
    const fromCode = {
      extends: 'host',
      inventory: { label: 'From code', sources: [{ index: 'a-*' }] },
    };
    builtInInventoryExtensions.register(fromCode);
    mockFind(soClient, { extensions: [storedExtension(hostExtensionDocument)] });

    const host = await createRegistry().getDefinition('host');
    expect(host?.inventorySource).toBe('code');
    expect(host?.definition.inventory).toEqual(fromCode.inventory);
    expect(host?.createdAt).toBeUndefined();
  });

  it('returns no extension for a type that is not built-in', async () => {
    codeDefinitions.register(k8sNodeInventoryDefinition);
    expect(await createRegistry().getInventoryExtension('k8s.node')).toBeUndefined();
    expect(await createRegistry().getInventoryExtension('unknown')).toBeUndefined();
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
    mockFind(soClient, { definitions: [stored(k8sDeploymentInventoryDefinition)] });
    const record = await createRegistry().getDefinition('k8s.deployment');
    expect(record).toMatchObject({
      source: 'api',
      createdAt: T0,
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
    mockFind(soClient, { definitions: [stored(k8sDeploymentInventoryDefinition)] });
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

  it('lists only definitions with an inventory extension when asked', async () => {
    mockFind(soClient, {
      definitions: [
        stored(k8sDeploymentInventoryDefinition),
        stored({
          type: 'plain.api',
          name: 'API definition without inventory',
          identityField: { singleField: 'plain.id' },
        }),
      ],
      extensions: [storedExtension(hostExtensionDocument)],
    });
    builtInInventoryExtensions.register({
      extends: 'user',
      inventory: { sources: [{ index: 'logs-*' }] },
    });
    codeDefinitions.register(k8sNodeInventoryDefinition);
    codeDefinitions.register({
      type: 'plain.code',
      name: 'code definition without inventory',
      identityField: { singleField: 'plain.id' },
    });
    const registry = createRegistry();

    const withInventory = await registry.getDefinitions({ inventory: true });
    expect(
      withInventory.map(({ definition, source, inventorySource }) => [
        definition.type,
        source,
        inventorySource,
      ])
    ).toEqual([
      ['user', 'built_in', 'code'],
      ['host', 'built_in', 'api'],
      ['k8s.node', 'code', undefined],
      ['k8s.deployment', 'api', undefined],
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

  it('caches API definitions and extensions per space until invalidated or expired', async () => {
    mockFind(soClient, {
      definitions: [stored(k8sDeploymentInventoryDefinition)],
      extensions: [storedExtension(hostExtensionDocument)],
    });
    const registry = createRegistry();

    await registry.getDefinition('k8s.deployment');
    await registry.getDefinition('host');
    await registry.getDefinitions();
    expect(findCalls(soClient, ENTITY_DEFINITION_SAVED_OBJECT_TYPE)).toBe(1);
    expect(findCalls(soClient, ENTITY_INVENTORY_EXTENSION_SAVED_OBJECT_TYPE)).toBe(1);

    // Another space is loaded separately.
    await createRegistry('space-b').getDefinitions();
    expect(findCalls(soClient, ENTITY_DEFINITION_SAVED_OBJECT_TYPE)).toBe(2);
    expect(findCalls(soClient, ENTITY_INVENTORY_EXTENSION_SAVED_OBJECT_TYPE)).toBe(2);

    // The two caches are independent.
    cache.invalidate(NAMESPACE);
    await registry.getDefinition('k8s.deployment');
    await registry.getDefinition('host');
    expect(findCalls(soClient, ENTITY_DEFINITION_SAVED_OBJECT_TYPE)).toBe(3);
    expect(findCalls(soClient, ENTITY_INVENTORY_EXTENSION_SAVED_OBJECT_TYPE)).toBe(2);

    extensionsCache.invalidate(NAMESPACE);
    await registry.getDefinition('host');
    expect(findCalls(soClient, ENTITY_INVENTORY_EXTENSION_SAVED_OBJECT_TYPE)).toBe(3);

    now += 30_001;
    await registry.getDefinition('k8s.deployment');
    await registry.getDefinition('host');
    expect(findCalls(soClient, ENTITY_DEFINITION_SAVED_OBJECT_TYPE)).toBe(4);
    expect(findCalls(soClient, ENTITY_INVENTORY_EXTENSION_SAVED_OBJECT_TYPE)).toBe(4);
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
    mockFind(soClient, { definitions: [valid, shadowsCode, materialised] });

    const registry = new EntityDefinitionRegistry({
      repository: new EntityDefinitionsRepository(soClient, NAMESPACE),
      cache: new EntityDefinitionsCache(),
      codeDefinitions,
      extensionsRepository: new InventoryExtensionsRepository(soClient, NAMESPACE),
      extensionsCache: new EntityDefinitionsCache(),
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
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(`${ENTITY_DEFINITION_SAVED_OBJECT_TYPE}-host.copy`)
    );
  });

  it('ignores stored extensions that fail the extension rules and logs why', async () => {
    const soClient = savedObjectsClientMock.create();
    const logger = loggerMock.create();
    const builtInInventoryExtensions = new BuiltInInventoryExtensionsRegistry();
    builtInInventoryExtensions.register({
      extends: 'user',
      inventory: { sources: [{ index: 'logs-*' }] },
    });
    const valid = storedExtension(hostExtensionDocument);
    const shadowedByCode = storedExtension({
      extends: 'user',
      inventory: { sources: [{ index: 'other-*' }] },
    });
    const notBuiltIn = storedExtension({
      extends: 'k8s.pod',
      inventory: { sources: [{ index: 'metrics-*' }] },
    });
    const identityAttribute = storedExtension({
      extends: 'service',
      inventory: { sources: [{ index: 'traces-*' }], attributes: ['service.name'] },
    });
    const typeMismatch = storedExtension(
      { extends: 'generic', inventory: { sources: [{ index: 'logs-*' }] } },
      'host'
    );
    mockFind(soClient, {
      extensions: [valid, shadowedByCode, notBuiltIn, identityAttribute, typeMismatch],
    });

    const registry = new EntityDefinitionRegistry({
      repository: new EntityDefinitionsRepository(soClient, NAMESPACE),
      cache: new EntityDefinitionsCache(),
      codeDefinitions: new CodeDefinitionsRegistry(),
      extensionsRepository: new InventoryExtensionsRepository(soClient, NAMESPACE),
      extensionsCache: new EntityDefinitionsCache(),
      builtInInventoryExtensions,
      namespace: NAMESPACE,
      logger,
    });

    const withInventory = await registry.getDefinitions({ inventory: true });
    expect(
      withInventory.map(({ definition, inventorySource }) => [definition.type, inventorySource])
    ).toEqual([
      ['user', 'code'],
      ['host', 'api'],
    ]);
    expect((await registry.getDefinition('service'))?.definition.inventory).toBeUndefined();
    expect((await registry.getDefinition('generic'))?.definition.inventory).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(4);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('registered in code'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('not a built-in entity type'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('identity field'));
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('does not match the extended type')
    );
  });
});
