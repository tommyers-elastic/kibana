/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { forbidden } from '@hapi/boom';
import type { KibanaRequest, Logger, Plugin, PluginInitializerContext } from '@kbn/core/server';
import { registerRoutes } from '@kbn/server-route-repository';
import { ENTITY_INVENTORY_ENABLED_SETTING } from '../common';
import type { EntityInventoryConfig } from './config';
import { InventoryService, SourceMetadataResolver } from './inventory/executor';
import { entityInventoryRouteRepository } from './routes';
import type {
  EntityInventoryCoreSetup,
  EntityInventoryCoreStart,
  EntityInventorySetupDependencies,
  EntityInventoryStartDependencies,
} from './types';
import { registerUiSettings } from './ui_settings';

export const INVENTORY_DISABLED_MESSAGE = `The entity inventory API is not enabled (ui setting "${ENTITY_INVENTORY_ENABLED_SETTING}" is off)`;

export class EntityInventoryPlugin
  implements Plugin<void, void, EntityInventorySetupDependencies, EntityInventoryStartDependencies>
{
  private readonly logger: Logger;
  private readonly metadata: SourceMetadataResolver;

  constructor(initializerContext: PluginInitializerContext<EntityInventoryConfig>) {
    this.logger = initializerContext.logger.get();
    const { sourceMetadataCacheTtlSeconds } = initializerContext.config.get();
    this.metadata = new SourceMetadataResolver(sourceMetadataCacheTtlSeconds * 1000);
  }

  public setup(core: EntityInventoryCoreSetup, _plugins: EntityInventorySetupDependencies) {
    registerUiSettings(core.uiSettings);

    const getInventoryService = async (request: KibanaRequest): Promise<InventoryService> => {
      const [coreStart, plugins] = await core.getStartServices();
      const soClient = coreStart.savedObjects.getScopedClient(request);
      const enabled = await coreStart.uiSettings
        .asScopedToClient(soClient)
        .get<boolean>(ENTITY_INVENTORY_ENABLED_SETTING);
      if (!enabled) {
        throw forbidden(INVENTORY_DISABLED_MESSAGE);
      }
      const spaceId = plugins.spaces?.spacesService.getSpaceId(request) ?? 'default';
      return new InventoryService({
        esClient: coreStart.elasticsearch.client.asScoped(request).asCurrentUser,
        registry: plugins.entityStore.getEntityDefinitionRegistry(spaceId),
        metadata: this.metadata,
        logger: this.logger,
      });
    };

    registerRoutes({
      repository: entityInventoryRouteRepository,
      dependencies: { getInventoryService },
      core,
      logger: this.logger,
      runDevModeChecks: false,
    });
  }

  public start(_core: EntityInventoryCoreStart, _plugins: EntityInventoryStartDependencies) {}

  public stop() {
    this.metadata.clear();
  }
}
