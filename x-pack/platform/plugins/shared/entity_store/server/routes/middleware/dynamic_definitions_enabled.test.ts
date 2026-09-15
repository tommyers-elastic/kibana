/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { IKibanaResponse, KibanaRequest, KibanaResponseFactory } from '@kbn/core/server';
import { loggerMock } from '@kbn/logging-mocks';
import type { EntityStoreRequestHandlerContext } from '../../types';
import { wrapDefinitionsMiddlewares } from '.';
import { DYNAMIC_DEFINITIONS_DISABLED_MESSAGE } from './dynamic_definitions_enabled';

jest.mock('../../telemetry/traces', () => ({
  runWithSpan: jest.fn(({ cb }) => cb()),
}));

describe('wrapDefinitionsMiddlewares', () => {
  let isDynamicDefinitionsEnabled: jest.Mock;
  let isEntityStoreV2Enabled: jest.Mock;
  let ctx: EntityStoreRequestHandlerContext;
  let req: KibanaRequest;
  let res: KibanaResponseFactory;

  beforeEach(() => {
    isDynamicDefinitionsEnabled = jest.fn().mockResolvedValue(true);
    isEntityStoreV2Enabled = jest.fn().mockResolvedValue(false);
    ctx = {
      entityStore: Promise.resolve({
        namespace: 'default',
        logger: loggerMock.create(),
        featureFlags: { isDynamicDefinitionsEnabled, isEntityStoreV2Enabled },
      }),
    } as unknown as EntityStoreRequestHandlerContext;
    req = {
      route: { method: 'get', path: '/internal/entity_store/definitions' },
    } as unknown as KibanaRequest;
    res = {
      customError: jest.fn(({ statusCode, body }) => ({ status: statusCode, payload: body })),
    } as unknown as KibanaResponseFactory;
  });

  it('runs the handler when the dynamic definitions setting is on, regardless of the Security store flag', async () => {
    const handler = jest.fn().mockResolvedValue({ status: 200 } as IKibanaResponse);
    const result = await wrapDefinitionsMiddlewares(handler)(ctx, req, res);

    expect(result.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(isEntityStoreV2Enabled).not.toHaveBeenCalled();
  });

  it('returns 403 and skips the handler when the setting is off', async () => {
    isDynamicDefinitionsEnabled.mockResolvedValue(false);
    const handler = jest.fn();
    const result = await wrapDefinitionsMiddlewares(handler)(ctx, req, res);

    expect(handler).not.toHaveBeenCalled();
    expect(res.customError).toHaveBeenCalledWith({
      statusCode: 403,
      body: { message: DYNAMIC_DEFINITIONS_DISABLED_MESSAGE },
    });
    expect(result).toEqual({
      status: 403,
      payload: { message: DYNAMIC_DEFINITIONS_DISABLED_MESSAGE },
    });
  });
});
