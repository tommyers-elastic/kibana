/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Middleware } from '.';
import { FF_ENABLE_DYNAMIC_DEFINITIONS } from '../../../common';

export const DYNAMIC_DEFINITIONS_DISABLED_MESSAGE = `Dynamic entity definitions are not enabled (ui setting "${FF_ENABLE_DYNAMIC_DEFINITIONS}" is off)`;

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
