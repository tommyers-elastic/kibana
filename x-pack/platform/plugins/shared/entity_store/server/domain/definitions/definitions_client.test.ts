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
import { buildInventoryEntityDefinition } from '../../../common/domain/definitions/inventory_definition';
import { getInventoryIdentity } from '../../../common/domain/definitions/entity_schema';
import { hostEntityDefinition } from '../../../common/domain/definitions/host';
import { getEntityDefinition as getBuiltInEntityDefinition } from '../../../common/domain/definitions/registry';
import {
  ENTITY_DEFINITION_SAVED_OBJECT_TYPE,
  ENTITY_INVENTORY_EXTENSION_SAVED_OBJECT_TYPE,
} from '../../../common';
import { EntityDefinitionsCache } from './definitions_cache';
import { EntityDefinitionsClient } from './definitions_client';
import { EntityDefinitionsRepository } from './definitions_repository';
import { InventoryExtensionsRepository } from './inventory_extensions_repository';
import {
  EntityDefinitionAlreadyExistsError,
  EntityDefinitionIdentityChangedError,
  EntityDefinitionNotFoundError,
  EntityDefinitionValidationError,
  InventoryExtensionAlreadyExistsError,
  InventoryExtensionCodeRegisteredError,
} from './errors';
import { BuiltInInventoryExtensionsRegistry } from './built_in_inventory_extensions';
import { CodeDefinitionsRegistry } from './code_definitions_registry';
import type { StoredInventoryExtensionAttributes } from './inventory_extension_saved_object';
import type { StoredEntityDefinitionAttributes } from './saved_object';

const NAMESPACE = 'default';
const SO_ID = `${ENTITY_DEFINITION_SAVED_OBJECT_TYPE}-k8s.deployment-${NAMESPACE}`;
const EXTENSION_SO_ID = `${ENTITY_INVENTORY_EXTENSION_SAVED_OBJECT_TYPE}-host-${NAMESPACE}`;
const hostInventoryExtension = {
  label: 'Hosts',
  attributes: ['host.os.name'],
  sources: [{ index: 'metrics-system.cpu-*' }],
};
const hostExtensionDocument = { extends: 'host', inventory: hostInventoryExtension };
const T0 = new Date('2026-09-15T10:00:00.000Z');
const T1 = new Date('2026-09-15T11:00:00.000Z');

describe('EntityDefinitionsClient', () => {
  let soClient: ReturnType<typeof savedObjectsClientMock.create>;
  let cache: EntityDefinitionsCache;
  let extensionsCache: EntityDefinitionsCache<StoredInventoryExtensionAttributes>;
  let codeDefinitions: CodeDefinitionsRegistry;
  let builtInInventoryExtensions: BuiltInInventoryExtensionsRegistry;
  let client: EntityDefinitionsClient;
  let clock: Date;

  /** `find` serves both saved object types from one mock, dispatching on the requested type. */
  const mockFind = ({
    definitions = [],
    extensions = [],
  }: {
    definitions?: StoredEntityDefinitionAttributes[];
    extensions?: StoredInventoryExtensionAttributes[];
  } = {}) => {
    soClient.find.mockImplementation(async ({ type }: SavedObjectsFindOptions) => {
      const objects: Array<StoredEntityDefinitionAttributes | StoredInventoryExtensionAttributes> =
        type === ENTITY_DEFINITION_SAVED_OBJECT_TYPE ? definitions : extensions;
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
  const mockStored = (...definitions: StoredEntityDefinitionAttributes[]) =>
    mockFind({ definitions });

  beforeEach(() => {
    soClient = savedObjectsClientMock.create();
    soClient.create.mockImplementation(async (type, attributes, options) => ({
      id: options?.id ?? 'id',
      type,
      attributes,
      references: [],
    }));
    cache = new EntityDefinitionsCache();
    extensionsCache = new EntityDefinitionsCache();
    codeDefinitions = new CodeDefinitionsRegistry();
    builtInInventoryExtensions = new BuiltInInventoryExtensionsRegistry();
    clock = T0;
    client = new EntityDefinitionsClient({
      repository: new EntityDefinitionsRepository(soClient, NAMESPACE),
      cache,
      codeDefinitions,
      extensionsRepository: new InventoryExtensionsRepository(soClient, NAMESPACE),
      extensionsCache,
      builtInInventoryExtensions,
      namespace: NAMESPACE,
      logger: loggerMock.create(),
      now: () => clock,
    });
    mockStored();
  });

  describe('create', () => {
    it('persists the definition with an explicit mode and returns the record', async () => {
      cache.set(NAMESPACE, []);
      const record = await client.create(k8sDeploymentInventoryDefinition);

      expect(soClient.create).toHaveBeenCalledWith(
        ENTITY_DEFINITION_SAVED_OBJECT_TYPE,
        {
          type: 'k8s.deployment',
          createdAt: T0.toISOString(),
          updatedAt: T0.toISOString(),
          definition: { ...k8sDeploymentInventoryDefinition, materialisation: { mode: 'none' } },
        },
        { id: SO_ID, refresh: 'wait_for' }
      );
      expect(record).toMatchObject({
        source: 'api',
        createdAt: T0.toISOString(),
        definition: { id: 'registered_k8s.deployment_default', type: 'k8s.deployment' },
      });
      expect(cache.get(NAMESPACE)).toBeUndefined();
    });

    it('defaults an absent materialisation to mode none', async () => {
      const { materialisation: _dropped, ...withoutMode } = k8sPodInventoryDefinition;
      const record = await client.create(withoutMode);
      expect(record.definition.materialisation).toEqual({ mode: 'none' });
    });

    it('rejects a built-in type name', async () => {
      await expect(
        client.create({ type: 'user', name: 'u', identityField: { singleField: 'user.name' } })
      ).rejects.toThrow(EntityDefinitionValidationError);
      expect(soClient.create).not.toHaveBeenCalled();
    });

    it('rejects a type registered in code', async () => {
      codeDefinitions.register(k8sNodeInventoryDefinition);
      await expect(client.create(k8sNodeInventoryDefinition)).rejects.toThrow(/registered in code/);
    });

    it('rejects a materialised definition', async () => {
      await expect(client.create({ ...hostEntityDefinition, type: 'host.copy' })).rejects.toThrow(
        /materialisation.mode must be "none"/
      );
    });

    it('rejects a body that fails the schema with the zod path', async () => {
      await expect(
        client.create({ type: 'k8s.pod', name: '', identityField: { singleField: 'a' } })
      ).rejects.toThrow(/Invalid entity definition document: name/);
    });

    it('rejects a body with neither or both of type and extends', async () => {
      await expect(client.create({ name: 'x' })).rejects.toThrow(
        /either "type" or "extends" is required/
      );
      await expect(
        client.create({ ...k8sPodInventoryDefinition, extends: 'host' })
      ).rejects.toThrow(/"type" and "extends" cannot both be set/);
      expect(soClient.create).not.toHaveBeenCalled();
    });

    it('rejects a duplicate type', async () => {
      mockStored(storedOf(k8sDeploymentInventoryDefinition));
      await expect(client.create(k8sDeploymentInventoryDefinition)).rejects.toThrow(
        EntityDefinitionAlreadyExistsError
      );
    });
  });

  describe('replace', () => {
    beforeEach(() => {
      mockStored(storedOf(k8sDeploymentInventoryDefinition));
      clock = T1;
    });

    it('keeps createdAt and stamps updatedAt when identity is unchanged', async () => {
      const relabelled = buildInventoryEntityDefinition({
        type: 'k8s.deployment',
        name: 'renamed',
        inventory: { ...k8sDeploymentInventoryDefinition.inventory!, label: 'Deployments' },
      });
      const record = await client.replace('k8s.deployment', relabelled);

      expect(soClient.update).toHaveBeenCalledWith(
        ENTITY_DEFINITION_SAVED_OBJECT_TYPE,
        SO_ID,
        {
          type: 'k8s.deployment',
          createdAt: T0.toISOString(),
          updatedAt: T1.toISOString(),
          definition: { ...relabelled, materialisation: { mode: 'none' } },
        },
        { refresh: 'wait_for', mergeAttributes: false }
      );
      expect(record).toMatchObject({
        updatedAt: T1.toISOString(),
        definition: { name: 'renamed' },
      });
    });

    it('rejects an identity change without force and accepts it with force', async () => {
      const reidentified = buildInventoryEntityDefinition({
        type: 'k8s.deployment',
        name: k8sDeploymentInventoryDefinition.name,
        inventory: {
          ...k8sDeploymentInventoryDefinition.inventory!,
          identity: [
            'kubernetes.cluster.name',
            'kubernetes.namespace',
            'kubernetes.deployment.name',
          ],
        },
      });
      await expect(client.replace('k8s.deployment', reidentified)).rejects.toThrow(
        EntityDefinitionIdentityChangedError
      );
      expect(soClient.update).not.toHaveBeenCalled();

      const record = await client.replace('k8s.deployment', reidentified, { force: true });
      expect(getInventoryIdentity(record.definition)).toHaveLength(3);
    });

    it('rejects a body whose type differs from the path', async () => {
      await expect(client.replace('k8s.deployment', k8sPodInventoryDefinition)).rejects.toThrow(
        /does not match the path type/
      );
    });

    it('rejects an unknown type', async () => {
      mockStored();
      await expect(
        client.replace('k8s.deployment', k8sDeploymentInventoryDefinition)
      ).rejects.toThrow(EntityDefinitionNotFoundError);
    });
  });

  describe('delete', () => {
    it('deletes an API definition and invalidates the cache', async () => {
      mockStored(storedOf(k8sDeploymentInventoryDefinition));
      cache.set(NAMESPACE, []);
      await client.delete('k8s.deployment');
      expect(soClient.delete).toHaveBeenCalledWith(ENTITY_DEFINITION_SAVED_OBJECT_TYPE, SO_ID, {
        refresh: 'wait_for',
      });
      expect(cache.get(NAMESPACE)).toBeUndefined();
    });

    it('refuses to delete built-in and code-registered types', async () => {
      codeDefinitions.register(k8sNodeInventoryDefinition);
      await expect(client.delete('host')).rejects.toThrow(
        /"host" is a built-in entity type and cannot be registered, replaced or deleted, and it has no API-registered inventory extension/
      );
      await expect(client.delete('k8s.node')).rejects.toThrow(/registered in code/);
      expect(soClient.delete).not.toHaveBeenCalled();
    });

    it('404s for an unknown type', async () => {
      await expect(client.delete('k8s.deployment')).rejects.toThrow(EntityDefinitionNotFoundError);
    });
  });

  describe('built-in inventory extensions', () => {
    const layeredHost = (extension: typeof hostInventoryExtension = hostInventoryExtension) => ({
      ...getBuiltInEntityDefinition('host', NAMESPACE),
      inventory: extension,
    });

    it('creates an extension for a built-in and returns the layered built-in record', async () => {
      extensionsCache.set(NAMESPACE, []);
      const record = await client.create(hostExtensionDocument);

      expect(soClient.create).toHaveBeenCalledWith(
        ENTITY_INVENTORY_EXTENSION_SAVED_OBJECT_TYPE,
        {
          type: 'host',
          createdAt: T0.toISOString(),
          updatedAt: T0.toISOString(),
          document: hostExtensionDocument,
        },
        { id: EXTENSION_SO_ID, refresh: 'wait_for' }
      );
      expect(record).toEqual({
        source: 'built_in',
        inventorySource: 'api',
        createdAt: T0.toISOString(),
        updatedAt: T0.toISOString(),
        definition: layeredHost(),
      });
      expect(extensionsCache.get(NAMESPACE)).toBeUndefined();
      // The definitions store is neither read nor written.
      expect(soClient.find).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: ENTITY_DEFINITION_SAVED_OBJECT_TYPE })
      );
    });

    it('rejects a duplicate extension on create and a code-registered one on any write', async () => {
      mockFind({ extensions: [storedExtensionOf(hostExtensionDocument)] });
      await expect(client.create(hostExtensionDocument)).rejects.toThrow(
        InventoryExtensionAlreadyExistsError
      );

      builtInInventoryExtensions.register({
        extends: 'user',
        inventory: { sources: [{ index: 'logs-*' }] },
      });
      const userDocument = { extends: 'user', inventory: { sources: [{ index: 'other-*' }] } };
      await expect(client.create(userDocument)).rejects.toThrow(
        InventoryExtensionCodeRegisteredError
      );
      await expect(client.replace('user', userDocument)).rejects.toThrow(
        InventoryExtensionCodeRegisteredError
      );
      await expect(client.delete('user')).rejects.toThrow(InventoryExtensionCodeRegisteredError);
      expect(soClient.create).not.toHaveBeenCalled();
      expect(soClient.update).not.toHaveBeenCalled();
      expect(soClient.delete).not.toHaveBeenCalled();
    });

    it('rejects an extends that is not built-in, identity-field attributes and schema failures', async () => {
      await expect(client.create({ ...hostExtensionDocument, extends: 'k8s.pod' })).rejects.toThrow(
        /not a built-in entity type and cannot be extended; register a full entity definition with "type"/
      );
      await expect(
        client.create({
          extends: 'host',
          inventory: { ...hostInventoryExtension, attributes: ['host.name'] },
        })
      ).rejects.toThrow(/attribute "host.name" is an identity field/);
      await expect(
        client.create({
          extends: 'host',
          inventory: { ...hostInventoryExtension, identity: ['host.name'] },
        })
      ).rejects.toThrow(/Invalid entity definition document: inventory: Unrecognized key/);
      await expect(client.create({ extends: 'host' })).rejects.toThrow(
        /Invalid entity definition document: inventory/
      );
      expect(soClient.create).not.toHaveBeenCalled();
    });

    it('creates on PUT when absent and replaces keeping createdAt when present', async () => {
      const created = await client.replace('host', hostExtensionDocument, { force: true });
      expect(created.inventorySource).toBe('api');
      expect(soClient.create).toHaveBeenCalledTimes(1);

      mockFind({ extensions: [storedExtensionOf(hostExtensionDocument)] });
      clock = T1;
      const relabelled = {
        extends: 'host',
        inventory: { ...hostInventoryExtension, label: 'Machines' },
      };
      const replaced = await client.replace('host', relabelled);
      expect(soClient.update).toHaveBeenCalledWith(
        ENTITY_INVENTORY_EXTENSION_SAVED_OBJECT_TYPE,
        EXTENSION_SO_ID,
        {
          type: 'host',
          createdAt: T0.toISOString(),
          updatedAt: T1.toISOString(),
          document: relabelled,
        },
        { refresh: 'wait_for', mergeAttributes: false }
      );
      expect(replaced).toEqual({
        source: 'built_in',
        inventorySource: 'api',
        createdAt: T0.toISOString(),
        updatedAt: T1.toISOString(),
        definition: layeredHost(relabelled.inventory),
      });
    });

    it('rejects a PUT whose path type differs from extends', async () => {
      await expect(client.replace('user', hostExtensionDocument)).rejects.toThrow(
        /The extended type "host" does not match the path type "user"/
      );
      expect(soClient.create).not.toHaveBeenCalled();
    });

    it('deletes the API extension of a built-in and invalidates the extensions cache only', async () => {
      mockFind({ extensions: [storedExtensionOf(hostExtensionDocument)] });
      cache.set(NAMESPACE, []);
      extensionsCache.set(NAMESPACE, []);
      await client.delete('host');
      expect(soClient.delete).toHaveBeenCalledWith(
        ENTITY_INVENTORY_EXTENSION_SAVED_OBJECT_TYPE,
        EXTENSION_SO_ID,
        { refresh: 'wait_for' }
      );
      expect(extensionsCache.get(NAMESPACE)).toBeUndefined();
      expect(cache.get(NAMESPACE)).toBeDefined();
    });
  });
});

function storedExtensionOf(
  document: StoredInventoryExtensionAttributes['document']
): StoredInventoryExtensionAttributes {
  return {
    type: document.extends,
    createdAt: T0.toISOString(),
    updatedAt: T0.toISOString(),
    document,
  };
}

function storedOf(
  definition: StoredEntityDefinitionAttributes['definition']
): StoredEntityDefinitionAttributes {
  return {
    type: definition.type,
    createdAt: T0.toISOString(),
    updatedAt: T0.toISOString(),
    definition,
  };
}
