/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { AgentAccessControlMode, type AgentCreateRequest } from '@kbn/agent-builder-common';
import type { AgentBuilderPluginSetup, AgentBuilderPluginStart } from '@kbn/agent-builder-server';
import type { AgentTypeDefinition } from '@kbn/agent-builder-server/agents';
import type { Logger } from '@kbn/core/server';
import {
  DEFINITION_AUTHORING_AGENT_ID,
  DEFINITION_AUTHORING_AGENT_TYPE_ID,
  DEFINITION_AUTHORING_SKILL_ID,
  DEFINITION_AUTHORING_TOOL_IDS,
} from './tool_ids';

export const DEFINITION_AUTHORING_AGENT_NAME = 'Entity definition author';

export const DEFINITION_AUTHORING_AGENT_DESCRIPTION =
  'Creates and edits entity inventory definitions (the documents that tell Kibana how to list, count and detail one kind of entity live from telemetry) by inspecting the data first, following the authoring rules, and previewing the result.';

const INSTRUCTIONS = `You author entity inventory definitions for Kibana's Observability entity inventory, following the entity-inventory-definitions skill exactly. A definition (or an extension of a built-in type) declares what identifies an entity and what to show for it; Kibana generates and runs the ES|QL.

Rules you never break:
- Inspect the data before writing anything: run ES|QL against the candidate streams to establish which fields exist, on which documents, with which values and units, and quote what you found. Never invent field names or assume they exist.
- Reuse what exists: list the registered types first, and fetch the current document before changing one.
- Propose the document, explain each choice with the evidence, and wait for the user's agreement before saving. Saving asks the user to confirm; if they decline, stop and ask how to continue.
- Always preview the type right after creating or replacing it, and read the queries, errors, unavailable columns and provenance back to the user. Fix the definition when the preview disagrees with the intent.
- Say so when you cannot see the data (no access, empty window) and mark the definition as unverified rather than guessing.`;

/**
 * The agent type carries the managed configuration (instructions, tools, skill), so updates ship
 * with code without rewriting the persisted agent document.
 */
export const definitionAuthoringAgentType = {
  id: DEFINITION_AUTHORING_AGENT_TYPE_ID,
  name: DEFINITION_AUTHORING_AGENT_NAME,
  description: DEFINITION_AUTHORING_AGENT_DESCRIPTION,
  avatar_icon: 'indexManagementApp',
  baseConfiguration: {
    instructions: INSTRUCTIONS,
    tools: [{ tool_ids: [...DEFINITION_AUTHORING_TOOL_IDS] }],
    skill_ids: [DEFINITION_AUTHORING_SKILL_ID],
    enable_elastic_capabilities: false,
  },
} as const satisfies AgentTypeDefinition;

export const registerAgentType = (agentBuilder: AgentBuilderPluginSetup): void => {
  agentBuilder.agents.registerType(definitionAuthoringAgentType);
};

/** The persisted agent: an empty delta over its type, so the type's configuration is the whole configuration. */
export const createAgentRequest = (): AgentCreateRequest => ({
  id: DEFINITION_AUTHORING_AGENT_ID,
  type: DEFINITION_AUTHORING_AGENT_TYPE_ID,
  name: DEFINITION_AUTHORING_AGENT_NAME,
  description: DEFINITION_AUTHORING_AGENT_DESCRIPTION,
  labels: ['observability', 'entity-inventory'],
  // Persisted agents store a symbol and colour, not an icon; the icon comes from the type.
  avatar_symbol: 'ED',
  access_control: { access_mode: AgentAccessControlMode.Shared },
  configuration: {
    tools: [],
    skill_ids: [],
    enable_elastic_capabilities: false,
  },
});

interface EnsureAgentParams {
  agentBuilder: AgentBuilderPluginStart;
  spaceId: string;
  logger: Logger;
}

/** Create-if-absent install of the agent in a space; logs and continues when Agent Builder rejects it. */
export const ensureAgentSafe = async ({
  agentBuilder,
  spaceId,
  logger,
}: EnsureAgentParams): Promise<void> => {
  try {
    await agentBuilder.agents.ensure({ spaceId, agent: createAgentRequest() });
    logger.debug(`Ensured agent "${DEFINITION_AUTHORING_AGENT_ID}" in space "${spaceId}"`);
  } catch (error) {
    logger.error(
      `Failed to ensure agent "${DEFINITION_AUTHORING_AGENT_ID}" in space "${spaceId}": ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
};
