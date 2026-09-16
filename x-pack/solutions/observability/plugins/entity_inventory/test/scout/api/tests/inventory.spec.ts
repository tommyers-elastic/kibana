/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { apiTest, type ApiClientFixture } from '@kbn/scout-oblt';
import { expect } from '@kbn/scout-oblt/api';
import type {
  InventoryCountResponse,
  InventoryListResponse,
  InventoryTypesResponse,
} from '../../../../common';
import {
  DEFINITIONS_HEADERS,
  DEFINITIONS_PATH,
  ENTITY_INVENTORY_ENABLED_SETTING,
  ENTITY_INVENTORY_TAGS,
  ENTITY_STORE_DYNAMIC_DEFINITIONS_SETTING,
  INVENTORY_HEADERS,
  INVENTORY_PATH,
} from '../fixtures/constants';
import {
  ALL_DEFINITIONS,
  EXPECTED_GROUPS_15M,
  EXPECTED_LIVE_15M,
  METRICS_INDEX,
  MISSING_INDEX,
  SEED_PODS,
  STATE_INDEX,
  WINDOW_15M,
  WINDOW_6H,
  createInventoryTestIndices,
  deleteInventoryTestIndices,
} from '../fixtures/seed';

const list = (type: string) => `${INVENTORY_PATH}/entities/${type}/_list`;
const detail = (type: string) => `${INVENTORY_PATH}/entities/${type}/_detail`;
const count = (type: string) => `${INVENTORY_PATH}/entities/${type}/_count`;

const byUid = (response: InventoryListResponse, uid: string) =>
  response.rows.find((row) => row['kubernetes.pod.uid'] === uid);

apiTest.describe('Entity inventory API', { tag: ENTITY_INVENTORY_TAGS }, () => {
  let headers: Record<string, string>;
  let definitionHeaders: Record<string, string>;

  const registerDefinitions = async (apiClient: ApiClientFixture) => {
    for (const definition of ALL_DEFINITIONS) {
      const created = await apiClient.post(DEFINITIONS_PATH, {
        headers: definitionHeaders,
        responseType: 'json',
        body: definition,
      });
      const response =
        created.statusCode === 409
          ? await apiClient.put(`${DEFINITIONS_PATH}/${definition.type}?force=true`, {
              headers: definitionHeaders,
              responseType: 'json',
              body: definition,
            })
          : created;
      expect([200, 201]).toContain(response.statusCode);
    }
  };

  const removeDefinitions = async (apiClient: ApiClientFixture) => {
    for (const definition of ALL_DEFINITIONS) {
      const response = await apiClient.delete(`${DEFINITIONS_PATH}/${definition.type}`, {
        headers: definitionHeaders,
      });
      expect([200, 404]).toContain(response.statusCode);
    }
  };

  apiTest.beforeAll(async ({ samlAuth, kbnClient, esClient, apiClient }) => {
    const credentials = await samlAuth.asInteractiveUser('admin');
    headers = { ...credentials.cookieHeader, ...INVENTORY_HEADERS };
    definitionHeaders = { ...credentials.cookieHeader, ...DEFINITIONS_HEADERS };
    await kbnClient.uiSettings.update({
      [ENTITY_STORE_DYNAMIC_DEFINITIONS_SETTING]: true,
      [ENTITY_INVENTORY_ENABLED_SETTING]: true,
    });
    await createInventoryTestIndices(esClient);
    await registerDefinitions(apiClient);
  });

  apiTest.afterAll(async ({ kbnClient, esClient, apiClient }) => {
    await removeDefinitions(apiClient);
    await deleteInventoryTestIndices(esClient);
    await kbnClient.uiSettings.update({
      [ENTITY_STORE_DYNAMIC_DEFINITIONS_SETTING]: false,
      [ENTITY_INVENTORY_ENABLED_SETTING]: false,
    });
  });

  apiTest(
    'lists the registered types with identity, columns and sources',
    async ({ apiClient }) => {
      const response = await apiClient.get(`${INVENTORY_PATH}/types`, {
        headers,
        responseType: 'json',
      });
      expect(response.statusCode).toBe(200);
      const { types }: InventoryTypesResponse = response.body;
      const pod = types.find((type) => type.type === 'invtest.pod');
      expect(pod).toBeDefined();
      expect(pod?.label).toBe('Test pod');
      expect(pod?.identity).toStrictEqual({ kind: 'tuple', fields: ['kubernetes.pod.uid'] });
      expect(pod?.columns.map(({ name, kind }) => `${kind}:${name}`)).toStrictEqual([
        'entity_id:entity.id',
        'identity:kubernetes.pod.uid',
        'attribute:kubernetes.pod.name',
        'attribute:kubernetes.namespace',
        'attribute:kubernetes.node.name',
        'attribute:phase',
        'metric:cpu_cores',
        'metric:mem_bytes',
        'metric:ghost',
        'last_seen:last_seen',
      ]);
      expect(pod?.sources.map(({ index }) => index)).toStrictEqual([
        METRICS_INDEX,
        STATE_INDEX,
        MISSING_INDEX,
      ]);
      expect(pod?.definitionSource).toBe('api');
      const group = types.find((type) => type.type === 'invtest.group');
      expect(group?.identity).toStrictEqual({
        kind: 'tuple',
        fields: ['kubernetes.namespace', 'kubernetes.node.name'],
      });
    }
  );

  apiTest(
    'lists the live pods of a 15 m window across sources: merged by identity, labelled phase, exact total, isolated failures',
    async ({ apiClient }) => {
      const response = await apiClient.post(list('invtest.pod'), {
        headers,
        responseType: 'json',
        body: { ...WINDOW_15M, limit: 100 },
      });
      expect(response.statusCode).toBe(200);
      const body: InventoryListResponse = response.body;

      expect(body.rows.map((row) => row['kubernetes.pod.uid']).sort()).toStrictEqual(
        EXPECTED_LIVE_15M
      );
      expect(body.total).toBe(EXPECTED_LIVE_15M.length);
      expect(body.truncated).toBe(false);

      const phaseLabel: Record<number, string> = { 2: 'running', 3: 'succeeded' };
      const round = (value: unknown) =>
        typeof value === 'number' ? Number(value.toFixed(6)) : value;
      for (const pod of SEED_PODS.filter(({ uid }) => EXPECTED_LIVE_15M.includes(uid))) {
        const reportedMetrics = pod.metricMinutes.length > 0;
        const { last_seen: lastSeen, ...row } = byUid(body, pod.uid) ?? {};
        expect(typeof lastSeen).toBe('string');
        expect({
          ...row,
          cpu_cores: round(row.cpu_cores),
          mem_bytes: round(row.mem_bytes),
        }).toStrictEqual({
          'entity.id': `invtest.pod:${pod.uid}`,
          'kubernetes.pod.uid': pod.uid,
          'kubernetes.pod.name': pod.name,
          'kubernetes.namespace': pod.namespace,
          'kubernetes.node.name': pod.node,
          cpu_cores: reportedMetrics ? round(pod.cpu) : null,
          mem_bytes: reportedMetrics ? round(pod.mem) : null,
          ghost: null,
          phase: pod.state ? phaseLabel[pod.state.phase] : null,
        });
      }

      // The missing index is reported and does not fail the request.
      expect(body.errors).toHaveLength(1);
      expect(body.errors[0].index).toBe(MISSING_INDEX);
      // The unmapped metric is reported and nullified.
      expect(body.unavailableColumns).toStrictEqual([
        { index: METRICS_INDEX, column: 'ghost', field: 'k8s.pod.ghost.metric' },
      ]);
      // Two TSDB source queries plus the cross-source count, all with their ES|QL and timings.
      expect(body.queries.map(({ index, engine }) => `${engine} ${index}`)).toStrictEqual([
        `TS ${METRICS_INDEX}`,
        `TS ${STATE_INDEX}`,
        'COUNT *',
      ]);
      for (const query of body.queries) {
        expect(query.esql).toContain('SET unmapped_fields="nullify"');
        expect(query.esql).not.toContain('NOW()');
        expect(query.tookMs).toBeGreaterThanOrEqual(0);
        expect(query.params).toStrictEqual({ from: WINDOW_15M.from, to: WINDOW_15M.to });
      }
      expect(body.queries[2].esql).toContain('METADATA _index');
      expect(body.tookMs).toBeGreaterThanOrEqual(body.esTookMs > 0 ? 1 : 0);
      expect(body.columns.find(({ name }) => name === 'cpu_cores')?.esType).toBe('double');
    }
  );

  apiTest(
    'sorts in Kibana across sources with nulls last and truncates at the limit against the exact total',
    async ({ apiClient }) => {
      const sorted = await apiClient.post(list('invtest.pod'), {
        headers,
        responseType: 'json',
        body: { ...WINDOW_15M, sort: { column: 'cpu_cores', direction: 'asc' } },
      });
      expect(sorted.statusCode).toBe(200);
      const rows = (sorted.body as InventoryListResponse).rows;
      expect(rows.map((row) => row['kubernetes.pod.uid'])).toStrictEqual([
        'pod-uid-1',
        'pod-uid-2',
        'pod-uid-3',
        'pod-uid-4',
        'pod-uid-5',
        'pod-uid-7',
      ]);

      const limited = await apiClient.post(list('invtest.pod'), {
        headers,
        responseType: 'json',
        body: { ...WINDOW_15M, limit: 2, sort: { column: 'cpu_cores', direction: 'desc' } },
      });
      const body: InventoryListResponse = limited.body;
      expect(body.rows.map((row) => row['kubernetes.pod.uid'])).toStrictEqual([
        'pod-uid-5',
        'pod-uid-4',
      ]);
      expect(body.total).toBe(EXPECTED_LIVE_15M.length);
      expect(body.truncated).toBe(true);
    }
  );

  apiTest('pushes sort and limit into ES|QL for a single-source type', async ({ apiClient }) => {
    const response = await apiClient.post(list('invtest.pod_single'), {
      headers,
      responseType: 'json',
      body: { ...WINDOW_15M, limit: 3, sort: { column: 'mem_bytes', direction: 'desc' } },
    });
    expect(response.statusCode).toBe(200);
    const body: InventoryListResponse = response.body;
    expect(body.rows.map((row) => row['kubernetes.pod.uid'])).toStrictEqual([
      'pod-uid-5',
      'pod-uid-4',
      'pod-uid-3',
    ]);
    expect(body.total).toBe(5);
    expect(body.truncated).toBe(true);
    expect(body.queries[0].esql).toContain('| SORT `mem_bytes` DESC NULLS LAST\n| LIMIT 3');
    expect(body.queries[0].engine).toBe('TS');
    expect(body.queries[0].esql).toContain('AVG(AVG_OVER_TIME(`k8s.pod.cpu.usage`))');
  });

  apiTest(
    'falls back to FROM for a standard index and returns the same entities and averages',
    async ({ apiClient }) => {
      const standard = await apiClient.post(list('invtest.pod_standard'), {
        headers,
        responseType: 'json',
        body: { ...WINDOW_15M, sort: { column: 'kubernetes.pod.uid', direction: 'asc' } },
      });
      const tsdb = await apiClient.post(list('invtest.pod_single'), {
        headers,
        responseType: 'json',
        body: { ...WINDOW_15M, sort: { column: 'kubernetes.pod.uid', direction: 'asc' } },
      });
      const fromBody: InventoryListResponse = standard.body;
      const tsBody: InventoryListResponse = tsdb.body;
      expect(fromBody.queries[0].engine).toBe('FROM');
      expect(fromBody.queries[0].esql).not.toContain('_OVER_TIME');
      expect(fromBody.rows.map((row) => row['kubernetes.pod.uid'])).toStrictEqual(
        tsBody.rows.map((row) => row['kubernetes.pod.uid'])
      );
      fromBody.rows.forEach((row, index) => {
        expect(row.cpu_cores as number).toBeCloseTo(tsBody.rows[index].cpu_cores as number, 9);
        expect(row.mem_bytes as number).toBeCloseTo(tsBody.rows[index].mem_bytes as number, 9);
      });
    }
  );

  apiTest(
    'details one entity over a wide window, none over a narrow one',
    async ({ apiClient }) => {
      const wide = await apiClient.post(detail('invtest.pod'), {
        headers,
        responseType: 'json',
        body: { ...WINDOW_6H, identity: { 'kubernetes.pod.uid': 'pod-uid-6' } },
      });
      expect(wide.statusCode).toBe(200);
      const wideBody: InventoryListResponse = wide.body;
      expect(wideBody.rows).toHaveLength(1);
      expect(wideBody.rows[0]['entity.id']).toBe('invtest.pod:pod-uid-6');
      expect(wideBody.rows[0].cpu_cores as number).toBeCloseTo(0.6, 6);
      expect(
        wideBody.queries.every(({ esql }) => esql.includes('`kubernetes.pod.uid` == ?id_0'))
      ).toBe(true);
      expect(wideBody.queries.every(({ params }) => params?.id_0 === 'pod-uid-6')).toBe(true);

      const narrow = await apiClient.post(detail('invtest.pod'), {
        headers,
        responseType: 'json',
        body: { ...WINDOW_15M, identity: { 'kubernetes.pod.uid': 'pod-uid-6' } },
      });
      expect((narrow.body as InventoryListResponse).rows).toHaveLength(0);
    }
  );

  apiTest(
    'groups a composite identity and computes composite entity ids after STATS',
    async ({ apiClient }) => {
      const response = await apiClient.post(list('invtest.group'), {
        headers,
        responseType: 'json',
        body: { ...WINDOW_15M, sort: { column: 'entity.id', direction: 'asc' } },
      });
      expect(response.statusCode).toBe(200);
      const body: InventoryListResponse = response.body;
      expect(
        body.rows.map((row) => ({
          id: row['entity.id'],
          namespace: row['kubernetes.namespace'],
          node: row['kubernetes.node.name'],
          pods: row.pods,
        }))
      ).toStrictEqual(
        EXPECTED_GROUPS_15M.map(({ namespace, node, pods }) => ({
          id: `invtest.group:${namespace}/${node}`,
          namespace,
          node,
          pods,
        }))
      );
      expect(body.total).toBe(EXPECTED_GROUPS_15M.length);
      const detailed = await apiClient.post(detail('invtest.group'), {
        headers,
        responseType: 'json',
        body: {
          ...WINDOW_15M,
          identity: { 'kubernetes.namespace': 'payments', 'kubernetes.node.name': 'node-a' },
        },
      });
      expect(
        (detailed.body as InventoryListResponse).rows.map((row) => row['entity.id'])
      ).toStrictEqual(['invtest.group:payments/node-a']);
    }
  );

  apiTest('counts exactly across sources and honours a query DSL filter', async ({ apiClient }) => {
    const all = await apiClient.post(count('invtest.pod'), {
      headers,
      responseType: 'json',
      body: WINDOW_15M,
    });
    expect(all.statusCode).toBe(200);
    expect((all.body as InventoryCountResponse).count).toBe(EXPECTED_LIVE_15M.length);
    expect((all.body as InventoryCountResponse).queries[0].engine).toBe('COUNT');

    const payments = await apiClient.post(count('invtest.pod'), {
      headers,
      responseType: 'json',
      body: { ...WINDOW_15M, filter: { term: { 'kubernetes.namespace': 'payments' } } },
    });
    expect((payments.body as InventoryCountResponse).count).toBe(3);

    const wide = await apiClient.post(count('invtest.pod'), {
      headers,
      responseType: 'json',
      body: WINDOW_6H,
    });
    expect((wide.body as InventoryCountResponse).count).toBe(EXPECTED_LIVE_15M.length + 1);

    const filteredList = await apiClient.post(list('invtest.pod'), {
      headers,
      responseType: 'json',
      body: { ...WINDOW_15M, filter: { term: { 'kubernetes.namespace': 'payments' } } },
    });
    const filteredBody: InventoryListResponse = filteredList.body;
    expect(filteredBody.rows.map((row) => row['kubernetes.pod.uid']).sort()).toStrictEqual([
      'pod-uid-1',
      'pod-uid-2',
      'pod-uid-3',
    ]);
    expect(filteredBody.total).toBe(3);
  });

  apiTest('rejects bad requests and unknown types', async ({ apiClient }) => {
    const unknownType = await apiClient.post(list('invtest.nope'), {
      headers,
      responseType: 'json',
      body: WINDOW_15M,
    });
    expect(unknownType.statusCode).toBe(404);

    const badRange = await apiClient.post(list('invtest.pod'), {
      headers,
      responseType: 'json',
      body: { from: WINDOW_15M.to, to: WINDOW_15M.from },
    });
    expect(badRange.statusCode).toBe(400);

    const badSort = await apiClient.post(list('invtest.pod'), {
      headers,
      responseType: 'json',
      body: { ...WINDOW_15M, sort: { column: 'nope', direction: 'asc' } },
    });
    expect(badSort.statusCode).toBe(400);

    const badIdentity = await apiClient.post(detail('invtest.pod'), {
      headers,
      responseType: 'json',
      body: { ...WINDOW_15M, identity: { 'kubernetes.pod.name': 'pod-1' } },
    });
    expect(badIdentity.statusCode).toBe(400);

    const badFilter = await apiClient.post(count('invtest.pod'), {
      headers,
      responseType: 'json',
      body: { ...WINDOW_15M, filter: { term: {}, range: {} } },
    });
    expect(badFilter.statusCode).toBe(400);
  });

  apiTest(
    'is gated by the ui setting and readable with the read privilege',
    async ({ apiClient, kbnClient, samlAuth }) => {
      await kbnClient.uiSettings.update({ [ENTITY_INVENTORY_ENABLED_SETTING]: false });
      try {
        const disabled = await apiClient.get(`${INVENTORY_PATH}/types`, {
          headers,
          responseType: 'json',
        });
        expect(disabled.statusCode).toBe(403);
        expect(disabled.body.message).toContain(ENTITY_INVENTORY_ENABLED_SETTING);
      } finally {
        await kbnClient.uiSettings.update({ [ENTITY_INVENTORY_ENABLED_SETTING]: true });
      }
      const viewer = await samlAuth.asInteractiveUser('viewer');
      const asViewer = await apiClient.post(count('invtest.pod'), {
        headers: { ...viewer.cookieHeader, ...INVENTORY_HEADERS },
        responseType: 'json',
        body: WINDOW_15M,
      });
      expect(asViewer.statusCode).toBe(200);
    }
  );
});
