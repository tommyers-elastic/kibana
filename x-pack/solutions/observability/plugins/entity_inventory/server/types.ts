/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { CoreSetup, CoreStart } from '@kbn/core/server';
import type { SpacesPluginStart } from '@kbn/spaces-plugin/server';
import type { EntityStoreSetupContract, EntityStoreStartContract } from '@kbn/entity-store/server';
import type { AgentBuilderPluginSetup, AgentBuilderPluginStart } from '@kbn/agent-builder-server';
import type {
  SearchInferenceEndpointsPluginSetup,
  SearchInferenceEndpointsPluginStart,
} from '@kbn/search-inference-endpoints/server';

export interface EntityInventorySetupDependencies {
  entityStore: EntityStoreSetupContract;
  agentBuilder?: AgentBuilderPluginSetup;
  searchInferenceEndpoints?: SearchInferenceEndpointsPluginSetup;
}

export interface EntityInventoryStartDependencies {
  entityStore: EntityStoreStartContract;
  spaces?: SpacesPluginStart;
  agentBuilder?: AgentBuilderPluginStart;
  searchInferenceEndpoints?: SearchInferenceEndpointsPluginStart;
}

export type EntityInventoryCoreSetup = CoreSetup<EntityInventoryStartDependencies>;
export type EntityInventoryCoreStart = CoreStart;
