/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { CoreSetup, CoreStart, Plugin, PluginInitializerContext } from '@kbn/core/public';
import type { GroupsPluginSetup, GroupsPluginStart, GroupsPluginSetupDeps } from './types';
import { PLUGIN_ID, PLUGIN_NAME } from '../common';

export class GroupsPlugin
  implements Plugin<GroupsPluginSetup, GroupsPluginStart, GroupsPluginSetupDeps>
{
  constructor(initializerContext: PluginInitializerContext) {}

  public setup(core: CoreSetup, plugins: GroupsPluginSetupDeps): GroupsPluginSetup {
    // Register the Groups application
    core.application.register({
      id: PLUGIN_ID,
      title: PLUGIN_NAME,
      euiIconType: 'folderOpen',
      order: 8000,
      category: {
        id: 'management',
        label: 'Management',
        order: 5000,
      },
      mount: async (params) => {
        const [coreStart] = await core.getStartServices();
        const { renderApp } = await import('./application');
        return renderApp(coreStart, params);
      },
    });

    return {};
  }

  public start(core: CoreStart): GroupsPluginStart {
    return {};
  }

  public stop() {}
}
