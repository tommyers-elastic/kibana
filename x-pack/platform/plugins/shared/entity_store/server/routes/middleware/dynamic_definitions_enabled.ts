/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Middleware } from '.';
import { DYNAMIC_DEFINITIONS_DISABLED_MESSAGE } from '../../domain/definitions';

export { DYNAMIC_DEFINITIONS_DISABLED_MESSAGE };

/**
 * Gates the definitions API on its own ui setting, independent of the Security entity store
 * feature flag: Observability may register definitions in spaces where Security never enabled
 * (or installed) the store.
 */
export const dynamicDefinitionsEnabledMiddleware: Middleware = async (ctx, _req, res) => {
  const { featureFlags } = await ctx.entityStore;
  if (!(await featureFlags.isDynamicDefinitionsEnabled())) {
    return res.customError({
      statusCode: 403,
      body: { message: DYNAMIC_DEFINITIONS_DISABLED_MESSAGE },
    });
  }
};
