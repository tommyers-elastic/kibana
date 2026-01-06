/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { CoreSetup, CoreStart, Plugin, PluginInitializerContext } from '@kbn/core/public';
import type { GroupsPluginSetup, GroupsPluginStart, GroupsPluginSetupDeps } from './types';

export class GroupsPlugin
  implements Plugin<GroupsPluginSetup, GroupsPluginStart, GroupsPluginSetupDeps>
{
  constructor(initializerContext: PluginInitializerContext) {}

  public setup(core: CoreSetup, plugins: GroupsPluginSetupDeps): GroupsPluginSetup {
    return {};
  }

  public start(core: CoreStart): GroupsPluginStart {
    return {};
  }

  public stop() {}
}
