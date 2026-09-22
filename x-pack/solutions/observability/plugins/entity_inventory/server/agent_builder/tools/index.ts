/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { AgentBuilderPluginSetup } from '@kbn/agent-builder-server';
import type { AgentBuilderToolDeps } from '../types';
import { createSaveDefinitionTool } from './save_definition';
import { createDeleteDefinitionTool } from './delete_definition';
import { createGetDefinitionTool } from './get_definition';
import { createListTypesTool } from './list_types';
import { createPreviewInventoryTool } from './preview_inventory';

export const registerTools = (
  agentBuilder: AgentBuilderPluginSetup,
  deps: AgentBuilderToolDeps
) => {
  agentBuilder.tools.register(createListTypesTool(deps));
  agentBuilder.tools.register(createGetDefinitionTool(deps));
  agentBuilder.tools.register(createPreviewInventoryTool(deps));
  agentBuilder.tools.register(createSaveDefinitionTool(deps));
  agentBuilder.tools.register(createDeleteDefinitionTool(deps));
};
