/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { apiTest, type ApiClientFixture } from '@kbn/scout';
import { expect } from '@kbn/scout/api';
import {
  INTERNAL_HEADERS,
  PUBLIC_HEADERS,
  ENTITY_STORE_TAGS,
} from '../../../common/fixtures/constants';
import {
  getStatus,
  installAllEntityTypes,
  uninstallAllEntityTypes,
} from '../../../common/fixtures/helpers';
import {
  ENTITY_DEFINITIONS_ROUTES,
  FF_ENABLE_DYNAMIC_DEFINITIONS,
  FF_ENABLE_ENTITY_STORE_V2,
  type EntityDefinitionRecord,
} from '../../../../../common';
import {
  INVENTORY_DEFINITION_FIXTURES,
  k8sDeploymentInventoryDefinition,
  k8sNodeInventoryDefinition,
  k8sPodInventoryDefinition,
} from '../../../../../common/domain/definitions/__fixtures__/inventory_definitions';
import { hostEntityDefinition } from '../../../../../common/domain/definitions/host';
import { buildInventoryEntityDefinition } from '../../../../../common/domain/definitions/inventory_definition';
import {
  getEuidDslFilterBasedOnDocumentFromDefinition,
  getEuidEsqlEvaluationFromDefinition,
  getEuidFromDefinition,
  getEuidKqlFilterBasedOnDocumentFromDefinition,
  getEuidPainlessEvaluationFromDefinition,
} from '../../../../../common/domain/euid';
import {
  ENTITY_SCHEMA_VERSION_V2,
  ENTITY_BASE_PREFIX,
} from '../../../../../common/domain/entity_index';

const OTHER_SPACE = 'entity-definitions-space-b';
const FIXTURE_TYPES = INVENTORY_DEFINITION_FIXTURES.map(({ type }) => type);
const BUILT_IN_TYPES = ['user', 'host', 'service', 'generic'];

const definitionsPath = (type?: string, space?: string) => {
  const base = `${space ? `/s/${space}` : ''}${ENTITY_DEFINITIONS_ROUTES.LIST}`;
  return type ? `${base}/${type}` : base;
};

const deleteIgnoringNotFound = async (
  apiClient: ApiClientFixture,
  headers: Record<string, string>,
  type: string,
  space?: string
) => {
  const response = await apiClient.delete(definitionsPath(type, space), { headers });
  expect([200, 404]).toContain(response.statusCode);
};

apiTest.describe('Entity definitions API', { tag: ENTITY_STORE_TAGS }, () => {
  let headers: Record<string, string>;
  let publicHeaders: Record<string, string>;

  apiTest.beforeAll(async ({ samlAuth, kbnClient }) => {
    const credentials = await samlAuth.asInteractiveUser('admin');
    headers = { ...credentials.cookieHeader, ...INTERNAL_HEADERS };
    publicHeaders = { ...credentials.cookieHeader, ...PUBLIC_HEADERS };
    await kbnClient.uiSettings.update({
      [FF_ENABLE_DYNAMIC_DEFINITIONS]: true,
      [FF_ENABLE_ENTITY_STORE_V2]: true,
    });
  });

  apiTest.beforeEach(async ({ apiClient }) => {
    for (const type of [...FIXTURE_TYPES, 'host.copy']) {
      await deleteIgnoringNotFound(apiClient, headers, type);
    }
  });

  apiTest.afterAll(async ({ apiClient, kbnClient }) => {
    for (const type of FIXTURE_TYPES) {
      await deleteIgnoringNotFound(apiClient, headers, type);
    }
    await kbnClient.uiSettings.update({ [FF_ENABLE_DYNAMIC_DEFINITIONS]: false });
  });

  apiTest('is gated on the dynamic definitions ui setting', async ({ apiClient, kbnClient }) => {
    await kbnClient.uiSettings.update({ [FF_ENABLE_DYNAMIC_DEFINITIONS]: false });
    try {
      const response = await apiClient.get(definitionsPath(), { headers, responseType: 'json' });
      expect(response.statusCode).toBe(403);
      expect(response.body.message).toContain(FF_ENABLE_DYNAMIC_DEFINITIONS);
    } finally {
      await kbnClient.uiSettings.update({ [FF_ENABLE_DYNAMIC_DEFINITIONS]: true });
    }
  });

  apiTest('lists the four built-ins as materialised in a fresh space', async ({ apiClient }) => {
    const materialised = await apiClient.get(`${definitionsPath()}?mode=extraction`, {
      headers,
      responseType: 'json',
    });
    expect(materialised.statusCode).toBe(200);
    const records: EntityDefinitionRecord[] = materialised.body.definitions;
    expect(records.map(({ definition }) => definition.type)).toStrictEqual(BUILT_IN_TYPES);
    expect(records.every(({ source }) => source === 'built_in')).toBe(true);
    expect(records[1].definition.id).toBe('security_host_default');

    const live = await apiClient.get(`${definitionsPath()}?mode=none`, {
      headers,
      responseType: 'json',
    });
    expect(live.statusCode).toBe(200);
    expect(live.body.definitions).toStrictEqual([]);

    const host = await apiClient.get(definitionsPath('host'), { headers, responseType: 'json' });
    expect(host.statusCode).toBe(200);
    expect(host.body.source).toBe('built_in');
  });

  apiTest(
    'registers the ported k8s definitions, reads them back and compiles ids from the returned objects',
    async ({ apiClient }) => {
      for (const definition of INVENTORY_DEFINITION_FIXTURES) {
        const created = await apiClient.post(definitionsPath(), {
          headers,
          responseType: 'json',
          body: definition,
        });
        expect(created.statusCode).toBe(201);
        expect(created.body).toMatchObject({
          source: 'api',
          definition: {
            ...definition,
            id: `registered_${definition.type}_default`,
            materialisation: { mode: 'none' },
          },
        });
        expect(created.body.createdAt).toBe(created.body.updatedAt);
      }

      const list = await apiClient.get(`${definitionsPath()}?mode=none`, {
        headers,
        responseType: 'json',
      });
      expect(list.statusCode).toBe(200);
      // The list is sorted by type.
      expect(
        (list.body.definitions as EntityDefinitionRecord[]).map(({ definition }) => definition.type)
      ).toStrictEqual([...FIXTURE_TYPES].sort());

      const read = await apiClient.get(definitionsPath('k8s.deployment'), {
        headers,
        responseType: 'json',
      });
      expect(read.statusCode).toBe(200);
      const { definition } = read.body as EntityDefinitionRecord;
      const doc = {
        kubernetes: { namespace: 'payments', deployment: { name: 'checkout-api' } },
      };

      // The five compiler backends work from the definition object the API returned.
      expect(getEuidFromDefinition(definition, doc)).toBe('k8s.deployment:payments/checkout-api');
      expect(getEuidEsqlEvaluationFromDefinition(definition, 'entity.id')).toContain(
        'kubernetes.deployment.name'
      );
      expect(getEuidDslFilterBasedOnDocumentFromDefinition(definition, doc)).toBeDefined();
      expect(getEuidKqlFilterBasedOnDocumentFromDefinition(definition, doc)).toContain(
        'kubernetes.namespace'
      );
      expect(getEuidPainlessEvaluationFromDefinition(definition)).toContain('k8s.deployment:');

      const podRead = await apiClient.get(definitionsPath('k8s.pod'), {
        headers,
        responseType: 'json',
      });
      expect(
        getEuidFromDefinition(podRead.body.definition, { kubernetes: { pod: { uid: 'abc' } } })
      ).toBe('k8s.pod:abc');
    }
  );

  apiTest('rejects a built-in type name with 400', async ({ apiClient }) => {
    const response = await apiClient.post(definitionsPath(), {
      headers,
      responseType: 'json',
      body: { type: 'host', name: 'not allowed', identityField: { singleField: 'host.name' } },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body.message).toContain('built-in entity type');

    const deletion = await apiClient.delete(definitionsPath('host'), {
      headers,
      responseType: 'json',
    });
    expect(deletion.statusCode).toBe(400);
  });

  apiTest('rejects a materialised dynamic definition with 400', async ({ apiClient }) => {
    const response = await apiClient.post(definitionsPath(), {
      headers,
      responseType: 'json',
      body: { ...hostEntityDefinition, type: 'host.copy' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body.message).toContain('materialisation.mode must be "none"');
  });

  apiTest('rejects unknown keys and schema violations with 400', async ({ apiClient }) => {
    const unknownKey = await apiClient.post(definitionsPath(), {
      headers,
      responseType: 'json',
      body: {
        ...k8sPodInventoryDefinition,
        inventory: { ...k8sPodInventoryDefinition.inventory, inventoryWindow: '15m' },
      },
    });
    expect(unknownKey.statusCode).toBe(400);

    const badType = await apiClient.post(definitionsPath(), {
      headers,
      responseType: 'json',
      body: { ...k8sPodInventoryDefinition, type: 'K8s Pod' },
    });
    expect(badType.statusCode).toBe(400);

    const inconsistentIdentity = await apiClient.post(definitionsPath(), {
      headers,
      responseType: 'json',
      body: { ...k8sPodInventoryDefinition, identityField: { singleField: 'kubernetes.pod.name' } },
    });
    expect(inconsistentIdentity.statusCode).toBe(400);
    expect(inconsistentIdentity.body.message).toContain('identityField');
  });

  apiTest(
    'replaces definitions and protects identity changes behind force',
    async ({ apiClient }) => {
      const created = await apiClient.post(definitionsPath(), {
        headers,
        responseType: 'json',
        body: k8sDeploymentInventoryDefinition,
      });
      expect(created.statusCode).toBe(201);

      const duplicate = await apiClient.post(definitionsPath(), {
        headers,
        responseType: 'json',
        body: k8sDeploymentInventoryDefinition,
      });
      expect(duplicate.statusCode).toBe(409);

      const relabelled = buildInventoryEntityDefinition({
        type: 'k8s.deployment',
        name: 'renamed',
        inventory: { ...k8sDeploymentInventoryDefinition.inventory!, label: 'Deployments' },
      });
      const replaced = await apiClient.put(definitionsPath('k8s.deployment'), {
        headers,
        responseType: 'json',
        body: relabelled,
      });
      expect(replaced.statusCode).toBe(200);
      expect(replaced.body.createdAt).toBe(created.body.createdAt);
      expect(Date.parse(replaced.body.updatedAt)).toBeGreaterThanOrEqual(
        Date.parse(created.body.updatedAt)
      );
      expect(replaced.body.definition.inventory.label).toBe('Deployments');

      const reidentified = buildInventoryEntityDefinition({
        type: 'k8s.deployment',
        name: 'renamed',
        inventory: {
          ...k8sDeploymentInventoryDefinition.inventory!,
          identity: [
            'kubernetes.cluster.name',
            'kubernetes.namespace',
            'kubernetes.deployment.name',
          ],
        },
      });
      const blocked = await apiClient.put(definitionsPath('k8s.deployment'), {
        headers,
        responseType: 'json',
        body: reidentified,
      });
      expect(blocked.statusCode).toBe(409);
      expect(blocked.body.message).toContain('force=true');

      const forced = await apiClient.put(`${definitionsPath('k8s.deployment')}?force=true`, {
        headers,
        responseType: 'json',
        body: reidentified,
      });
      expect(forced.statusCode).toBe(200);
      expect(forced.body.definition.inventory.identity).toHaveLength(3);
      expect(
        getEuidFromDefinition(forced.body.definition, {
          kubernetes: {
            cluster: { name: 'prod' },
            namespace: 'payments',
            deployment: { name: 'checkout-api' },
          },
        })
      ).toBe('k8s.deployment:prod/payments/checkout-api');

      const typeMismatch = await apiClient.put(definitionsPath('k8s.deployment'), {
        headers,
        responseType: 'json',
        body: k8sNodeInventoryDefinition,
      });
      expect(typeMismatch.statusCode).toBe(400);

      const deleted = await apiClient.delete(definitionsPath('k8s.deployment'), {
        headers,
        responseType: 'json',
      });
      expect(deleted.statusCode).toBe(200);
      expect((await apiClient.get(definitionsPath('k8s.deployment'), { headers })).statusCode).toBe(
        404
      );
      expect(
        (await apiClient.delete(definitionsPath('k8s.deployment'), { headers })).statusCode
      ).toBe(404);
      expect(
        (
          await apiClient.put(definitionsPath('k8s.deployment'), {
            headers,
            body: relabelled,
          })
        ).statusCode
      ).toBe(404);
    }
  );

  apiTest(
    'creates no engine, template or task for a registered type and leaves the store install unchanged',
    async ({ apiClient, esClient }) => {
      const created = await apiClient.post(definitionsPath(), {
        headers,
        responseType: 'json',
        body: k8sPodInventoryDefinition,
      });
      expect(created.statusCode).toBe(201);

      try {
        await installAllEntityTypes(apiClient, publicHeaders);
        const status = await getStatus(apiClient, publicHeaders, { includeComponents: true });
        expect(status.statusCode).toBe(200);
        expect(status.body.engines.map(({ type }) => type).sort()).toStrictEqual(
          [...BUILT_IN_TYPES].sort()
        );

        // A wildcard with no match is a 404.
        const templates = await esClient.cluster.getComponentTemplate(
          { name: `${ENTITY_BASE_PREFIX}-${ENTITY_SCHEMA_VERSION_V2}-*k8s.pod*` },
          { ignore: [404] }
        );
        expect(templates.component_templates ?? []).toStrictEqual([]);

        const tasks = await esClient.search({
          index: '.kibana_task_manager*',
          size: 1,
          query: { wildcard: { 'task.taskType': { value: '*k8s.pod*' } } },
        });
        expect(tasks.hits.hits).toStrictEqual([]);
      } finally {
        await uninstallAllEntityTypes(apiClient, publicHeaders);
      }
    }
  );

  apiTest('scopes registered definitions to their space', async ({ apiClient, kbnClient }) => {
    await kbnClient.request({
      method: 'POST',
      path: '/api/spaces/space',
      body: { id: OTHER_SPACE, name: OTHER_SPACE, disabledFeatures: [] },
    });
    // The ui setting is space-scoped: enable the API in the other space too.
    await kbnClient.uiSettings.update(
      { [FF_ENABLE_DYNAMIC_DEFINITIONS]: true },
      { space: OTHER_SPACE }
    );
    try {
      const inDefault = await apiClient.post(definitionsPath(), {
        headers,
        responseType: 'json',
        body: k8sPodInventoryDefinition,
      });
      expect(inDefault.statusCode).toBe(201);

      const missingInOther = await apiClient.get(definitionsPath('k8s.pod', OTHER_SPACE), {
        headers,
        responseType: 'json',
      });
      expect(missingInOther.statusCode).toBe(404);

      const inOther = await apiClient.post(definitionsPath(undefined, OTHER_SPACE), {
        headers,
        responseType: 'json',
        body: k8sNodeInventoryDefinition,
      });
      expect(inOther.statusCode).toBe(201);
      expect(inOther.body.definition.id).toBe(`registered_k8s.node_${OTHER_SPACE}`);

      const otherList = await apiClient.get(
        `${definitionsPath(undefined, OTHER_SPACE)}?mode=none`,
        {
          headers,
          responseType: 'json',
        }
      );
      expect(
        (otherList.body.definitions as EntityDefinitionRecord[]).map(
          ({ definition }) => definition.type
        )
      ).toStrictEqual(['k8s.node']);

      const missingInDefault = await apiClient.get(definitionsPath('k8s.node'), {
        headers,
        responseType: 'json',
      });
      expect(missingInDefault.statusCode).toBe(404);
    } finally {
      await kbnClient.request({
        method: 'DELETE',
        path: `/api/spaces/space/${OTHER_SPACE}`,
        ignoreErrors: [404],
      });
    }
  });

  apiTest(
    'requires the manage privilege to write and the read privilege to read',
    async ({ apiClient, samlAuth }) => {
      const viewer = await samlAuth.asInteractiveUser('viewer');
      const viewerHeaders = { ...viewer.cookieHeader, ...INTERNAL_HEADERS };

      const read = await apiClient.get(definitionsPath(), { headers: viewerHeaders });
      expect(read.statusCode).toBe(200);

      const write = await apiClient.post(definitionsPath(), {
        headers: viewerHeaders,
        responseType: 'json',
        body: k8sPodInventoryDefinition,
      });
      expect(write.statusCode).toBe(403);
    }
  );
});
