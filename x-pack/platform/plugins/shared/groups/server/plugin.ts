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
  KibanaRequest,
} from '@kbn/core/server';
import { registerRoutes } from '@kbn/server-route-repository';

import type { GroupsPluginSetup, GroupsPluginStart, GroupsPluginSetupDeps } from './types';
import { GroupsStorageClient, MembersStorageClient } from './lib/storage';
import { groupsRouteRepository } from './routes';
import { registerGroupsFeature } from './lib/features';
import { ACLService } from './lib/acl';

export class GroupsPlugin
  implements Plugin<GroupsPluginSetup, GroupsPluginStart, GroupsPluginSetupDeps>
{
  private readonly logger: Logger;
  private groupsStorageClient?: GroupsStorageClient;
  private membersStorageClient?: MembersStorageClient;
  private aclService?: ACLService;

  constructor(initializerContext: PluginInitializerContext) {
    this.logger = initializerContext.logger.get();
  }

  public setup(core: CoreSetup, plugins: GroupsPluginSetupDeps): GroupsPluginSetup {
    this.logger.info('Groups plugin setup');

    // Register Kibana feature for access control
    registerGroupsFeature(plugins.features);

    // Create a function to get scoped clients (initializes on first use)
    const getScopedClients = async ({ request }: { request: KibanaRequest }) => {
      // Lazy initialization: wait for storage clients to be ready
      if (!this.groupsStorageClient || !this.membersStorageClient || !this.aclService) {
        const [coreStart] = await core.getStartServices();
        const esClient = coreStart.elasticsearch.client.asInternalUser;

        this.groupsStorageClient = new GroupsStorageClient(
          esClient,
          this.logger.get('storage.groups')
        );
        this.membersStorageClient = new MembersStorageClient(
          esClient,
          this.logger.get('storage.members')
        );
        this.aclService = new ACLService(coreStart.security, this.logger.get('acl'));

        this.logger.info('Groups storage clients and ACL service initialized');
      }

      return {
        groupsClient: this.groupsStorageClient,
        membersClient: this.membersStorageClient,
        aclService: this.aclService,
      };
    };

    // Register routes using the @kbn/server-route-repository utility
    // The dependencies object is spread into the handler context
    registerRoutes({
      core,
      repository: groupsRouteRepository,
      logger: this.logger,
      dependencies: {
        getScopedClients,
      },
      runDevModeChecks: false,
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
