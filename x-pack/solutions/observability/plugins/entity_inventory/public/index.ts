/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { PluginInitializer } from '@kbn/core/public';
import { EntityInventoryPlugin } from './plugin';
import type { EntityInventoryPublicSetup, EntityInventoryPublicStart } from './plugin';

export type { EntityInventoryPublicSetup, EntityInventoryPublicStart };

export const plugin: PluginInitializer<
  EntityInventoryPublicSetup,
  EntityInventoryPublicStart
> = () => new EntityInventoryPlugin();
