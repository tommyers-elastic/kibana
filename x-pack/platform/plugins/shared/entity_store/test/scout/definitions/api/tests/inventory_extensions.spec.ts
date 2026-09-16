/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { apiTest, type ApiClientFixture } from '@kbn/scout';
import { expect } from '@kbn/scout/api';
import { INTERNAL_HEADERS, ENTITY_STORE_TAGS } from '../../../common/fixtures/constants';
import {
  ENTITY_DEFINITIONS_ROUTES,
  FF_ENABLE_DYNAMIC_DEFINITIONS,
  type EntityDefinitionRecord,
} from '../../../../../common';
import { hostEntityDefinition } from '../../../../../common/domain/definitions/host';
import { k8sPodInventoryDefinition } from '../../../../../common/domain/definitions/__fixtures__/inventory_definitions';

const OTHER_SPACE = 'entity-inventory-extensions-space-b';

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

const definitionsPath = (type?: string, space?: string) => {
  const base = `${space ? `/s/${space}` : ''}${ENTITY_DEFINITIONS_ROUTES.LIST}`;
  return type ? `${base}/${type}` : base;
};

/** A bare built-in answers DELETE with 400, an extension with 200 and a missing dynamic type with 404. */
const deleteIgnoringAbsent = async (
  apiClient: ApiClientFixture,
  headers: Record<string, string>,
  type: string,
  space?: string
) => {
  const response = await apiClient.delete(definitionsPath(type, space), { headers });
  expect([200, 400, 404]).toContain(response.statusCode);
};

apiTest.describe(
  'Entity definitions API: inventory extensions of built-in types',
  { tag: ENTITY_STORE_TAGS },
  () => {
    let headers: Record<string, string>;

    apiTest.beforeAll(async ({ samlAuth, kbnClient }) => {
      const credentials = await samlAuth.asInteractiveUser('admin');
      headers = { ...credentials.cookieHeader, ...INTERNAL_HEADERS };
      await kbnClient.uiSettings.update({ [FF_ENABLE_DYNAMIC_DEFINITIONS]: true });
    });

    apiTest.beforeEach(async ({ apiClient }) => {
      for (const type of ['host', 'user', 'k8s.pod']) {
        await deleteIgnoringAbsent(apiClient, headers, type);
      }
    });

    apiTest.afterAll(async ({ apiClient, kbnClient }) => {
      for (const type of ['host', 'user', 'k8s.pod']) {
        await deleteIgnoringAbsent(apiClient, headers, type);
      }
      await kbnClient.uiSettings.update({ [FF_ENABLE_DYNAMIC_DEFINITIONS]: false });
    });

    apiTest(
      'creates an extension for host and serves the layered built-in in get and list',
      async ({ apiClient }) => {
        const created = await apiClient.post(definitionsPath(), {
          headers,
          responseType: 'json',
          body: hostExtensionDocument,
        });
        expect(created.statusCode).toBe(201);
        const record: EntityDefinitionRecord = created.body;
        expect(record.source).toBe('built_in');
        expect(record.inventorySource).toBe('api');
        expect(record.createdAt).toBeDefined();
        expect(record.definition.id).toBe('security_host_default');
        expect(record.definition.type).toBe('host');
        expect(record.definition.inventory).toStrictEqual(hostInventoryExtension);
        // Identity and materialisation are the built-in's, untouched.
        expect(record.definition.identityField).toStrictEqual(hostEntityDefinition.identityField);
        expect(record.definition.materialisation?.mode).toBe('extraction');

        const fetched = await apiClient.get(definitionsPath('host'), {
          headers,
          responseType: 'json',
        });
        expect(fetched.statusCode).toBe(200);
        expect(fetched.body).toStrictEqual(created.body);

        const withInventory = await apiClient.get(`${definitionsPath()}?inventory=true`, {
          headers,
          responseType: 'json',
        });
        expect(withInventory.statusCode).toBe(200);
        const records: EntityDefinitionRecord[] = withInventory.body.definitions;
        expect(records.every(({ definition }) => definition.inventory !== undefined)).toBe(true);
        expect(records.find(({ definition }) => definition.type === 'host')).toStrictEqual(
          created.body
        );

        const materialised = await apiClient.get(`${definitionsPath()}?mode=extraction`, {
          headers,
          responseType: 'json',
        });
        const builtIns: EntityDefinitionRecord[] = materialised.body.definitions;
        expect(builtIns.map(({ definition }) => definition.type)).toStrictEqual([
          'user',
          'host',
          'service',
          'generic',
        ]);
        expect(
          builtIns.filter(({ definition }) => definition.inventory !== undefined)
        ).toHaveLength(1);
        expect(
          builtIns.filter(({ inventorySource }) => inventorySource !== undefined)
        ).toHaveLength(1);
      }
    );

    apiTest(
      'PUT creates or replaces idempotently, POST rejects a duplicate and DELETE removes it',
      async ({ apiClient }) => {
        const created = await apiClient.put(definitionsPath('host'), {
          headers,
          responseType: 'json',
          body: hostExtensionDocument,
        });
        expect(created.statusCode).toBe(200);
        expect(created.body.inventorySource).toBe('api');

        const duplicate = await apiClient.post(definitionsPath(), {
          headers,
          responseType: 'json',
          body: hostExtensionDocument,
        });
        expect(duplicate.statusCode).toBe(409);

        const relabelled = {
          extends: 'host',
          inventory: { ...hostInventoryExtension, label: 'Machines' },
        };
        const replaced = await apiClient.put(`${definitionsPath('host')}?force=false`, {
          headers,
          responseType: 'json',
          body: relabelled,
        });
        expect(replaced.statusCode).toBe(200);
        expect(replaced.body.createdAt).toBe(created.body.createdAt);
        expect(Date.parse(replaced.body.updatedAt)).toBeGreaterThanOrEqual(
          Date.parse(created.body.updatedAt)
        );
        expect(replaced.body.definition.inventory.label).toBe('Machines');

        const pathMismatch = await apiClient.put(definitionsPath('user'), {
          headers,
          responseType: 'json',
          body: hostExtensionDocument,
        });
        expect(pathMismatch.statusCode).toBe(400);
        expect(pathMismatch.body.message).toContain('does not match the path type');

        const deleted = await apiClient.delete(definitionsPath('host'), {
          headers,
          responseType: 'json',
        });
        expect(deleted.statusCode).toBe(200);

        const bare = await apiClient.get(definitionsPath('host'), {
          headers,
          responseType: 'json',
        });
        expect(bare.statusCode).toBe(200);
        expect(bare.body.definition.inventory).toBeUndefined();
        expect(bare.body.inventorySource).toBeUndefined();

        // A bare built-in keeps the "cannot be deleted" answer.
        const deleteAgain = await apiClient.delete(definitionsPath('host'), {
          headers,
          responseType: 'json',
        });
        expect(deleteAgain.statusCode).toBe(400);
        expect(deleteAgain.body.message).toContain('built-in entity type');
      }
    );

    apiTest('rejects invalid extension documents with 400', async ({ apiClient }) => {
      const notBuiltIn = await apiClient.post(definitionsPath(), {
        headers,
        responseType: 'json',
        body: { ...hostExtensionDocument, extends: 'k8s.pod' },
      });
      expect(notBuiltIn.statusCode).toBe(400);
      expect(notBuiltIn.body.message).toContain('not a built-in entity type');
      expect(notBuiltIn.body.message).toContain('"type"');

      const identityAttribute = await apiClient.post(definitionsPath(), {
        headers,
        responseType: 'json',
        body: {
          extends: 'host',
          inventory: { ...hostInventoryExtension, attributes: ['host.name'] },
        },
      });
      expect(identityAttribute.statusCode).toBe(400);
      expect(identityAttribute.body.message).toContain('"host.name"');
      expect(identityAttribute.body.message).toContain('identity field');

      const neither = await apiClient.post(definitionsPath(), {
        headers,
        responseType: 'json',
        body: { name: 'Hosts', inventory: hostInventoryExtension },
      });
      expect(neither.statusCode).toBe(400);
      expect(neither.body.message).toContain('either "type" or "extends" is required');

      const both = await apiClient.post(definitionsPath(), {
        headers,
        responseType: 'json',
        body: { ...k8sPodInventoryDefinition, extends: 'host' },
      });
      expect(both.statusCode).toBe(400);
      expect(both.body.message).toContain('cannot both be set');

      const withIdentity = await apiClient.post(definitionsPath(), {
        headers,
        responseType: 'json',
        body: {
          extends: 'host',
          inventory: { ...hostInventoryExtension, identity: ['host.name'] },
        },
      });
      expect(withIdentity.statusCode).toBe(400);

      const unknownKey = await apiClient.post(definitionsPath(), {
        headers,
        responseType: 'json',
        body: { ...hostExtensionDocument, name: 'Hosts' },
      });
      expect(unknownKey.statusCode).toBe(400);

      const bare = await apiClient.get(definitionsPath('host'), { headers, responseType: 'json' });
      expect(bare.body.definition.inventory).toBeUndefined();
    });

    apiTest('scopes extensions to their space', async ({ apiClient, kbnClient }) => {
      await kbnClient.request({
        method: 'POST',
        path: '/api/spaces/space',
        body: { id: OTHER_SPACE, name: OTHER_SPACE, disabledFeatures: [] },
      });
      await kbnClient.uiSettings.update(
        { [FF_ENABLE_DYNAMIC_DEFINITIONS]: true },
        { space: OTHER_SPACE }
      );
      try {
        const inOther = await apiClient.post(definitionsPath(undefined, OTHER_SPACE), {
          headers,
          responseType: 'json',
          body: hostExtensionDocument,
        });
        expect(inOther.statusCode).toBe(201);
        expect(inOther.body.definition.id).toBe(`security_host_${OTHER_SPACE}`);

        const inDefault = await apiClient.get(definitionsPath('host'), {
          headers,
          responseType: 'json',
        });
        expect(inDefault.statusCode).toBe(200);
        expect(inDefault.body.definition.inventory).toBeUndefined();

        const otherList = await apiClient.get(
          `${definitionsPath(undefined, OTHER_SPACE)}?inventory=true`,
          { headers, responseType: 'json' }
        );
        expect(
          (otherList.body.definitions as EntityDefinitionRecord[]).map(
            ({ definition }) => definition.type
          )
        ).toStrictEqual(['host']);
      } finally {
        await kbnClient.request({
          method: 'DELETE',
          path: `/api/spaces/space/${OTHER_SPACE}`,
          ignoreErrors: [404],
        });
      }
    });

    apiTest(
      'requires the manage privilege to write extensions and the read privilege to read them',
      async ({ apiClient, samlAuth }) => {
        const viewer = await samlAuth.asInteractiveUser('viewer');
        const viewerHeaders = { ...viewer.cookieHeader, ...INTERNAL_HEADERS };

        const put = await apiClient.put(definitionsPath('host'), {
          headers: viewerHeaders,
          responseType: 'json',
          body: hostExtensionDocument,
        });
        expect(put.statusCode).toBe(403);

        const post = await apiClient.post(definitionsPath(), {
          headers: viewerHeaders,
          responseType: 'json',
          body: hostExtensionDocument,
        });
        expect(post.statusCode).toBe(403);

        const read = await apiClient.get(definitionsPath('host'), { headers: viewerHeaders });
        expect(read.statusCode).toBe(200);
      }
    );
  }
);
