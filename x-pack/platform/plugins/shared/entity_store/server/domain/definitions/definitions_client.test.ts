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
import { buildInventoryEntityDefinition } from '../../../common/domain/definitions/inventory_definition';
import { getInventoryIdentity } from '../../../common/domain/definitions/entity_schema';
import { hostEntityDefinition } from '../../../common/domain/definitions/host';
import { ENTITY_DEFINITION_SAVED_OBJECT_TYPE } from '../../../common';
import { EntityDefinitionsCache } from './definitions_cache';
import { EntityDefinitionsClient } from './definitions_client';
import { EntityDefinitionsRepository } from './definitions_repository';
import {
  EntityDefinitionAlreadyExistsError,
  EntityDefinitionIdentityChangedError,
  EntityDefinitionNotFoundError,
  EntityDefinitionValidationError,
} from './errors';
import { CodeDefinitionsRegistry } from './code_definitions_registry';
import type { StoredEntityDefinitionAttributes } from './saved_object';

const NAMESPACE = 'default';
const SO_ID = `${ENTITY_DEFINITION_SAVED_OBJECT_TYPE}-k8s.deployment-${NAMESPACE}`;
const T0 = new Date('2026-09-15T10:00:00.000Z');
const T1 = new Date('2026-09-15T11:00:00.000Z');

describe('EntityDefinitionsClient', () => {
  let soClient: ReturnType<typeof savedObjectsClientMock.create>;
  let cache: EntityDefinitionsCache;
  let codeDefinitions: CodeDefinitionsRegistry;
  let client: EntityDefinitionsClient;
  let clock: Date;

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
    soClient.create.mockImplementation(async (type, attributes, options) => ({
      id: options?.id ?? 'id',
      type,
      attributes,
      references: [],
    }));
    cache = new EntityDefinitionsCache();
    codeDefinitions = new CodeDefinitionsRegistry();
    clock = T0;
    client = new EntityDefinitionsClient({
      repository: new EntityDefinitionsRepository(soClient, NAMESPACE),
      cache,
      codeDefinitions,
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
      ).rejects.toThrow(/Invalid entity definition: name/);
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
      await expect(client.delete('host')).rejects.toThrow(/built-in entity type/);
      await expect(client.delete('k8s.node')).rejects.toThrow(/registered in code/);
      expect(soClient.delete).not.toHaveBeenCalled();
    });

    it('404s for an unknown type', async () => {
      await expect(client.delete('k8s.deployment')).rejects.toThrow(EntityDefinitionNotFoundError);
    });
  });
});

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
