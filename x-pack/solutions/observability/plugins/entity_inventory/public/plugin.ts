/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { AppMountParameters, CoreSetup, CoreStart, Plugin } from '@kbn/core/public';
import { DEFAULT_APP_CATEGORIES } from '@kbn/core/public';
import type { AgentBuilderPluginStart } from '@kbn/agent-builder-browser';
import { i18n } from '@kbn/i18n';

/** Reachable at `/app/entityInventoryDefinitions`; hidden from navigation (dev management UI). */
export const ENTITY_INVENTORY_DEFINITIONS_APP_ID = 'entityInventoryDefinitions';

export type EntityInventoryPublicSetup = void;
export type EntityInventoryPublicStart = void;

export interface EntityInventoryPublicStartDependencies {
  /** Enables the AI-assisted authoring entry points when the Agent Builder plugin is present. */
  agentBuilder?: AgentBuilderPluginStart;
}

export class EntityInventoryPlugin
  implements
    Plugin<
      EntityInventoryPublicSetup,
      EntityInventoryPublicStart,
      {},
      EntityInventoryPublicStartDependencies
    >
{
  public setup(
    core: CoreSetup<EntityInventoryPublicStartDependencies>
  ): EntityInventoryPublicSetup {
    core.application.register({
      id: ENTITY_INVENTORY_DEFINITIONS_APP_ID,
      title: i18n.translate('xpack.entityInventory.definitionsApp.title', {
        defaultMessage: 'Entity definitions',
      }),
      category: DEFAULT_APP_CATEGORIES.observability,
      euiIconType: 'indexManagementApp',
      visibleIn: [],
      mount: async ({ element }: AppMountParameters) => {
        const [[coreStart, { agentBuilder }], { renderApp }] = await Promise.all([
          core.getStartServices(),
          import('./application/render_app'),
        ]);
        return renderApp({ coreStart, agentBuilder, element });
      },
    });
  }

  public start(_core: CoreStart): EntityInventoryPublicStart {}

  public stop() {}
}
