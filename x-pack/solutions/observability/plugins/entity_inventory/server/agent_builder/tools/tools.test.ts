/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { forbidden } from '@hapi/boom';
import type { KibanaRequest, Logger } from '@kbn/core/server';
import { ToolResultType } from '@kbn/agent-builder-common/tools/tool_result';
import type { ToolHandlerContext, ToolHandlerReturn } from '@kbn/agent-builder-server';
import type { EntityDefinitionRecord } from '@kbn/entity-store/common';
import type { EntityDefinitionRegistry, EntityDefinitionsClient } from '@kbn/entity-store/server';
import {
  DynamicDefinitionsDisabledError,
  EntityDefinitionAlreadyExistsError,
  EntityDefinitionIdentityChangedError,
} from '@kbn/entity-store/server';
import type { InventoryListResponse } from '../../../common';
import { hostDefinition, podDefinition } from '../../inventory/__fixtures__/definitions';
import type { InventoryService } from '../../inventory/executor';
import { InventoryTypeNotFoundError } from '../../inventory/executor';
import type { AgentBuilderToolDeps } from '../types';
import { createSaveDefinitionTool } from './save_definition';
import { createDeleteDefinitionTool } from './delete_definition';
import { createGetDefinitionTool } from './get_definition';
import { createListTypesTool } from './list_types';
import { createPreviewInventoryTool, windowEndingNow } from './preview_inventory';

const logger = { debug: jest.fn(), error: jest.fn(), warn: jest.fn() } as unknown as Logger;
const request = {} as KibanaRequest;
const context = { request, spaceId: 'default' } as unknown as ToolHandlerContext;

const apiPod: EntityDefinitionRecord = { definition: podDefinition, source: 'api' };
const builtInHost: EntityDefinitionRecord = {
  definition: hostDefinition,
  source: 'built_in',
  inventorySource: 'api',
};

const registryOf = (records: EntityDefinitionRecord[]): EntityDefinitionRegistry =>
  ({
    getDefinitions: jest.fn(async () => records),
    getDefinition: jest.fn(async (type: string) =>
      records.find(({ definition }) => definition.type === type)
    ),
  } as unknown as EntityDefinitionRegistry);

const depsWith = (overrides: Partial<AgentBuilderToolDeps> = {}): AgentBuilderToolDeps => ({
  logger,
  getInventoryService: jest.fn(async () => {
    throw forbidden('inventory is off');
  }),
  getDefinitionRegistry: jest.fn(async () => registryOf([apiPod, builtInHost])),
  getDefinitionsClient: jest.fn(async () => {
    throw new DynamicDefinitionsDisabledError();
  }),
  ...overrides,
});

const single = (returned: ToolHandlerReturn) => {
  if (!('results' in returned)) {
    throw new Error('expected a standard tool return');
  }
  expect(returned.results).toHaveLength(1);
  return returned.results[0];
};

describe('list_types tool', () => {
  it('summarises every inventory type of the space', async () => {
    const deps = depsWith();
    const tool = createListTypesTool(deps);

    const result = single(await tool.handler({ includeWithoutInventory: false }, context));

    expect(result.type).toBe(ToolResultType.other);
    const data = result.data as { total: number; types: Array<{ type: string; editable: string }> };
    expect(data.total).toBe(2);
    expect(data.types.map(({ type, editable }) => [type, editable])).toEqual([
      ['k8s.pod', 'definition'],
      ['host', 'extension'],
    ]);
    expect(deps.getDefinitionRegistry).toHaveBeenCalledWith('default');
    const registry = await (deps.getDefinitionRegistry as jest.Mock).mock.results[0].value;
    expect(registry.getDefinitions).toHaveBeenCalledWith({ inventory: true });
  });

  it('passes an empty filter when types without an inventory are wanted', async () => {
    const deps = depsWith();
    await createListTypesTool(deps).handler({ includeWithoutInventory: true }, context);
    const registry = await (deps.getDefinitionRegistry as jest.Mock).mock.results[0].value;
    expect(registry.getDefinitions).toHaveBeenCalledWith({});
  });

  it('returns an error result instead of throwing', async () => {
    const deps = depsWith({
      getDefinitionRegistry: jest.fn(async () => {
        throw new Error('registry down');
      }),
    });
    const result = single(
      await createListTypesTool(deps).handler({ includeWithoutInventory: false }, context)
    );
    expect(result.type).toBe(ToolResultType.error);
    expect(result.data).toMatchObject({ message: expect.stringContaining('registry down') });
  });
});

describe('get_definition tool', () => {
  it('returns the definition document of a known type', async () => {
    const result = single(
      await createGetDefinitionTool(depsWith()).handler({ type: 'k8s.pod' }, context)
    );
    expect(result.type).toBe(ToolResultType.other);
    expect(result.data).toMatchObject({ type: 'k8s.pod', kind: 'definition' });
    expect((result.data as { document: Record<string, unknown> }).document).not.toHaveProperty(
      'id'
    );
  });

  it('returns a not-found error with a hint for an unknown type', async () => {
    const result = single(
      await createGetDefinitionTool(depsWith()).handler({ type: 'nope' }, context)
    );
    expect(result.type).toBe(ToolResultType.error);
    expect(result.data).toMatchObject({
      message: expect.stringContaining('"nope"'),
      metadata: { kind: 'not_found', hint: expect.stringContaining('list_types') },
    });
  });
});

describe('preview_inventory tool', () => {
  const listResponse: InventoryListResponse = {
    type: 'k8s.pod',
    columns: [{ name: 'entity.id', kind: 'entity_id' }],
    rows: [{ 'entity.id': 'k8s.pod:a' }],
    provenance: {},
    total: 1,
    truncated: false,
    tookMs: 3,
    esTookMs: 2,
    queries: [{ index: 'metrics-*', engine: 'TS', esql: 'TS metrics-*', params: {}, tookMs: 2 }],
    unavailableColumns: [],
    errors: [],
  };

  it('computes a window ending now', () => {
    const now = new Date('2026-09-16T12:00:00.000Z');
    expect(windowEndingNow(15, now)).toEqual({
      from: '2026-09-16T11:45:00.000Z',
      to: '2026-09-16T12:00:00.000Z',
    });
  });

  it('runs the list over the window and returns the shaped response', async () => {
    const list = jest.fn(async () => listResponse);
    const deps = depsWith({
      getInventoryService: jest.fn(async () => ({ list } as unknown as InventoryService)),
    });

    const result = single(
      await createPreviewInventoryTool(deps).handler(
        { type: 'k8s.pod', minutes: 30, limit: 5 },
        context
      )
    );

    expect(result.type).toBe(ToolResultType.other);
    expect(list).toHaveBeenCalledWith('k8s.pod', {
      from: expect.any(String),
      to: expect.any(String),
      limit: 5,
    });
    const [, { from, to }] = list.mock.calls[0] as unknown as [
      string,
      { from: string; to: string }
    ];
    expect(Date.parse(to) - Date.parse(from)).toBe(30 * 60_000);
    expect(result.data).toMatchObject({
      type: 'k8s.pod',
      total: 1,
      returnedRows: 1,
      queries: [{ index: 'metrics-*', engine: 'TS', esql: 'TS metrics-*' }],
    });
    expect(
      (result.data as { queries: Array<Record<string, unknown>> }).queries[0]
    ).not.toHaveProperty('params');
  });

  it('reports a disabled inventory as a result, not a throw', async () => {
    const result = single(
      await createPreviewInventoryTool(depsWith()).handler(
        { type: 'k8s.pod', minutes: 15, limit: 20 },
        context
      )
    );
    expect(result.type).toBe(ToolResultType.error);
    expect(result.data).toMatchObject({
      message: expect.stringContaining('inventory is off'),
      metadata: { kind: 'forbidden', hint: expect.stringContaining('entityInventory:enabled') },
    });
  });

  it('reports an unknown type as not found', async () => {
    const deps = depsWith({
      getInventoryService: jest.fn(
        async () =>
          ({
            list: async () => {
              throw new InventoryTypeNotFoundError('nope');
            },
          } as unknown as InventoryService)
      ),
    });
    const result = single(
      await createPreviewInventoryTool(deps).handler(
        { type: 'nope', minutes: 15, limit: 20 },
        context
      )
    );
    expect(result.type).toBe(ToolResultType.error);
    expect(result.data).toMatchObject({ metadata: { kind: 'not_found' } });
  });
});

describe('save_definition tool', () => {
  const validDefinition = {
    type: 'k8s.pod',
    name: 'pods',
    identityField: { singleField: 'kubernetes.pod.uid' },
    materialisation: { mode: 'none' },
    inventory: {
      sources: [{ index: 'metrics-*' }],
    },
  };

  const clientWith = (overrides: Partial<EntityDefinitionsClient>): EntityDefinitionsClient =>
    ({
      create: jest.fn(async () => apiPod),
      replace: jest.fn(async () => apiPod),
      delete: jest.fn(async () => undefined),
      ...overrides,
    } as unknown as EntityDefinitionsClient);

  it('returns validation issues without touching the store', async () => {
    const deps = depsWith();
    const result = single(
      await createSaveDefinitionTool(deps).handler(
        { document: { type: 'k8s.pod' }, replace: false, force: false },
        context
      )
    );
    expect(result.type).toBe(ToolResultType.error);
    const { metadata } = result.data as {
      metadata: { kind: string; issues: Array<{ path: string; message: string }> };
    };
    expect(metadata.kind).toBe('validation');
    expect(metadata.issues.length).toBeGreaterThan(0);
    expect(deps.getDefinitionsClient).not.toHaveBeenCalled();
  });

  it('creates through the request-scoped client and points to the preview', async () => {
    const client = clientWith({});
    const deps = depsWith({ getDefinitionsClient: jest.fn(async () => client) });

    const result = single(
      await createSaveDefinitionTool(deps).handler(
        { document: validDefinition, replace: false, force: false },
        context
      )
    );

    expect(deps.getDefinitionsClient).toHaveBeenCalledWith(request);
    expect(client.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'k8s.pod',
        identityField: { singleField: 'kubernetes.pod.uid' },
      })
    );
    expect(client.replace).not.toHaveBeenCalled();
    expect(result.type).toBe(ToolResultType.other);
    expect(result.data).toMatchObject({
      action: 'created',
      type: 'k8s.pod',
      kind: 'definition',
      next: expect.stringContaining('preview_inventory'),
    });
  });

  it('replaces with the force flag passed through', async () => {
    const client = clientWith({});
    const deps = depsWith({ getDefinitionsClient: jest.fn(async () => client) });

    await createSaveDefinitionTool(deps).handler(
      { document: validDefinition, replace: true, force: true },
      context
    );

    expect(client.replace).toHaveBeenCalledWith(
      'k8s.pod',
      expect.objectContaining({ type: 'k8s.pod' }),
      {
        force: true,
      }
    );
  });

  it('explains conflicts as actionable errors', async () => {
    const exists = clientWith({
      create: jest.fn(async () => {
        throw new EntityDefinitionAlreadyExistsError('k8s.pod', 'default');
      }),
      replace: jest.fn(async () => {
        throw new EntityDefinitionIdentityChangedError('k8s.pod');
      }),
    });
    const deps = depsWith({ getDefinitionsClient: jest.fn(async () => exists) });
    const tool = createSaveDefinitionTool(deps);

    const created = single(
      await tool.handler({ document: validDefinition, replace: false, force: false }, context)
    );
    expect(created.data).toMatchObject({
      metadata: { kind: 'conflict', hint: expect.stringContaining('replace: true') },
    });

    const replaced = single(
      await tool.handler({ document: validDefinition, replace: true, force: false }, context)
    );
    expect(replaced.data).toMatchObject({
      metadata: { kind: 'conflict', hint: expect.stringContaining('force: true') },
    });
  });

  it('reports the dynamic definitions setting being off', async () => {
    const result = single(
      await createSaveDefinitionTool(depsWith()).handler(
        { document: validDefinition, replace: false, force: false },
        context
      )
    );
    expect(result.data).toMatchObject({
      message: expect.stringContaining('entityStore:dynamicDefinitionsEnabled'),
      metadata: { kind: 'disabled' },
    });
  });

  it('asks for confirmation with a summary of the document', async () => {
    const tool = createSaveDefinitionTool(depsWith());
    const confirmation = await tool.confirmation?.getConfirmation?.({
      toolParams: { document: validDefinition, replace: true, force: true },
      context,
    });
    expect(tool.confirmation?.askUser).toBe('always');
    expect(confirmation).toMatchObject({
      title: expect.stringContaining('"k8s.pod"'),
      message: expect.stringContaining('`metrics-*`'),
      confirm_text: 'Replace definition',
    });
    expect(confirmation?.message).toContain('Identity changes are forced');
  });
});

describe('delete_definition tool', () => {
  it('deletes through the request-scoped client after confirmation', async () => {
    const client = { delete: jest.fn(async () => undefined) } as unknown as EntityDefinitionsClient;
    const deps = depsWith({ getDefinitionsClient: jest.fn(async () => client) });
    const tool = createDeleteDefinitionTool(deps);

    expect(tool.annotations.destructiveHint).toBe(true);
    expect(tool.confirmation?.askUser).toBe('always');
    const result = single(await tool.handler({ type: 'k8s.pod' }, context));
    expect(client.delete).toHaveBeenCalledWith('k8s.pod');
    expect(result.data).toEqual({ action: 'deleted', type: 'k8s.pod' });
  });
});
