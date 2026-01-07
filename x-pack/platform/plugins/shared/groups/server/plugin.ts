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
import { GroupsStorageClient, MembersStorageClient } from './lib/storage';

export class GroupsPlugin
  implements Plugin<GroupsPluginSetup, GroupsPluginStart, GroupsPluginSetupDeps>
{
  private readonly logger: Logger;
  private groupsStorageClient?: GroupsStorageClient;
  private membersStorageClient?: MembersStorageClient;

  constructor(initializerContext: PluginInitializerContext) {
    this.logger = initializerContext.logger.get();
  }

  public setup(core: CoreSetup, plugins: GroupsPluginSetupDeps): GroupsPluginSetup {
    this.logger.info('Groups plugin setup');

    // Initialize storage clients when core services are available
    core.getStartServices().then(([coreStart]) => {
      const esClient = coreStart.elasticsearch.client.asInternalUser;

      this.groupsStorageClient = new GroupsStorageClient(
        esClient,
        this.logger.get('storage.groups')
      );
      this.membersStorageClient = new MembersStorageClient(
        esClient,
        this.logger.get('storage.members')
      );

      this.logger.info('Groups storage clients initialized');
    });

    return {};
  }

  public start(core: CoreStart): GroupsPluginStart {
    this.logger.info('Groups plugin started');

    if (!this.groupsStorageClient || !this.membersStorageClient) {
      this.logger.warn('Storage clients not initialized');
    }

    return {
      getGroupsStorageClient: () => {
        if (!this.groupsStorageClient) {
          throw new Error('Groups storage client not initialized');
        }
        return this.groupsStorageClient;
      },
      getMembersStorageClient: () => {
        if (!this.membersStorageClient) {
          throw new Error('Members storage client not initialized');
        }
        return this.membersStorageClient;
      },
    };
  }

  public stop() {}
}
