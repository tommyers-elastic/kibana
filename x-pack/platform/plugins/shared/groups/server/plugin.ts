/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type {
  PluginInitializerContext,
  CoreSetup,
  CoreStart,
  Plugin,
  Logger,
} from '@kbn/core/server';

import type { GroupsPluginSetup, GroupsPluginStart, GroupsPluginSetupDeps } from './types';

export class GroupsPlugin
  implements Plugin<GroupsPluginSetup, GroupsPluginStart, GroupsPluginSetupDeps>
{
  private readonly logger: Logger;

  constructor(initializerContext: PluginInitializerContext) {
    this.logger = initializerContext.logger.get();
  }

  public setup(core: CoreSetup, plugins: GroupsPluginSetupDeps): GroupsPluginSetup {
    this.logger.info('Groups plugin setup');
    return {};
  }

  public start(core: CoreStart): GroupsPluginStart {
    this.logger.info('Groups plugin started');
    return {};
  }

  public stop() {}
}
