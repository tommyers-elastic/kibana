/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { AgentBuilderPluginSetup } from '@kbn/agent-builder-server';
import type { Logger } from '@kbn/core/server';
import { registerAgentType } from './agent';
import { createDefinitionAuthoringSkill } from './skills/definition_authoring';
import { registerTools } from './tools';
import type { AgentBuilderToolDeps } from './types';

export { ensureAgentSafe } from './agent';
export { registerInferenceFeatures } from './inference_features';
export type { AgentBuilderToolDeps } from './types';

/** Registers the authoring skill, its tools and the dedicated agent type with Agent Builder at setup. */
export const registerAgentBuilder = ({
  agentBuilder,
  deps,
  logger,
}: {
  agentBuilder: AgentBuilderPluginSetup;
  deps: AgentBuilderToolDeps;
  logger: Logger;
}): void => {
  registerTools(agentBuilder, deps);
  agentBuilder.skills.register(createDefinitionAuthoringSkill());
  registerAgentType(agentBuilder);
  logger.debug('Registered the entity inventory definition authoring skill, tools and agent type');
};
