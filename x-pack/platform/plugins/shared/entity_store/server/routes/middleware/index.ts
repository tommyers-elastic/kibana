/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { IKibanaResponse, KibanaRequest, KibanaResponseFactory } from '@kbn/core/server';
import { runWithSpan } from '../../telemetry/traces';
import type { EntityStoreRequestHandlerContext } from '../../types';
import { featureFlagEnabledMiddleware } from './feature_flag_enabled';
import { dynamicDefinitionsEnabledMiddleware } from './dynamic_definitions_enabled';

export type Handler<P, Q, B, R> = (
  ctx: EntityStoreRequestHandlerContext,
  req: KibanaRequest<P, Q, B>,
  res: KibanaResponseFactory
) => Promise<R>;

export type Middleware = Handler<unknown, unknown, unknown, IKibanaResponse | undefined>;
type ReqHandler<P, Q, B> = Handler<P, Q, B, IKibanaResponse>;

const REGISTERED_MIDDLEWARES: readonly Middleware[] = [featureFlagEnabledMiddleware];

/** Entity store routes: the Security entity store v2 feature flag, then any route-specific middleware. */
export function wrapMiddlewares<P, Q, B>(
  handler: ReqHandler<P, Q, B>,
  middlewares: readonly Middleware[] = []
) {
  return wrapWithPipeline(handler, [...REGISTERED_MIDDLEWARES, ...middlewares]);
}

/** Definitions API routes: gated on the dynamic definitions ui setting only, not on the Security store flag. */
export function wrapDefinitionsMiddlewares<P, Q, B>(handler: ReqHandler<P, Q, B>) {
  return wrapWithPipeline(handler, [dynamicDefinitionsEnabledMiddleware]);
}

function wrapWithPipeline<P, Q, B>(handler: ReqHandler<P, Q, B>, pipeline: readonly Middleware[]) {
  return async (
    ctx: EntityStoreRequestHandlerContext,
    req: KibanaRequest<P, Q, B>,
    res: KibanaResponseFactory
  ) => {
    const entityStoreCtx = await ctx.entityStore;
    const path = req.route.path;
    const method = req.route.method.toLowerCase();

    return runWithSpan({
      name: 'entityStore.api',
      namespace: entityStoreCtx.namespace,
      attributes: {
        'entity_store.api.method': method,
        'entity_store.api.path': path,
      },
      cb: async () => {
        for (const middleware of pipeline) {
          const middlewareRes = await middleware(ctx, req, res);
          if (middlewareRes) {
            return middlewareRes;
          }
        }
        return handler(ctx, req, res);
      },
    });
  };
}
