/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { validateAgentId } from '@kbn/agent-builder-common/agents';
import { validateToolId } from '@kbn/agent-builder-common/tools';
import {
  isAllowedAgentType,
  isAllowedBuiltinSkill,
  isAllowedBuiltinTool,
} from '@kbn/agent-builder-server/allow_lists';
import { validateSkillDefinition } from '@kbn/agent-builder-server/skills/type_definition';
import { createAgentRequest, definitionAuthoringAgentType } from './agent';
import {
  DEFINITION_AUTHORING_INFERENCE_FEATURE_ID,
  ENTITY_INVENTORY_INFERENCE_FEATURE_ID,
} from './inference_features';
import { createDefinitionAuthoringSkill } from './skills/definition_authoring';
import {
  DATA_EXPLORATION_TOOL_IDS,
  DEFINITION_AUTHORING_AGENT_ID,
  DEFINITION_AUTHORING_AGENT_TYPE_ID,
  DEFINITION_AUTHORING_SKILL_ID,
  ENTITY_INVENTORY_TOOL_IDS,
} from './tool_ids';

/** Agent Builder rejects invalid ids at setup with a FATAL, so every id is checked here against its rules. */
describe('agent builder ids', () => {
  it.each(Object.values(ENTITY_INVENTORY_TOOL_IDS))(
    'tool id "%s" is valid and allow-listed',
    (id) => {
      expect(validateToolId({ toolId: id, builtIn: true })).toBeUndefined();
      expect(isAllowedBuiltinTool(id)).toBe(true);
    }
  );

  it.each(DATA_EXPLORATION_TOOL_IDS)('platform tool "%s" is allow-listed', (id) => {
    expect(isAllowedBuiltinTool(id)).toBe(true);
  });

  it('agent id is valid for a system-installed agent', () => {
    expect(
      validateAgentId({ agentId: DEFINITION_AUTHORING_AGENT_ID, builtIn: true })
    ).toBeUndefined();
    expect(createAgentRequest().id).toBe(DEFINITION_AUTHORING_AGENT_ID);
    expect(createAgentRequest().type).toBe(DEFINITION_AUTHORING_AGENT_TYPE_ID);
  });

  it('agent type id is allow-listed and carries the skill and tools', () => {
    expect(isAllowedAgentType(DEFINITION_AUTHORING_AGENT_TYPE_ID)).toBe(true);
    expect(definitionAuthoringAgentType.id).toBe(DEFINITION_AUTHORING_AGENT_TYPE_ID);
    expect(definitionAuthoringAgentType.baseConfiguration.skill_ids).toEqual([
      DEFINITION_AUTHORING_SKILL_ID,
    ]);
    expect(definitionAuthoringAgentType.baseConfiguration.tools[0].tool_ids).toEqual(
      expect.arrayContaining([
        ...Object.values(ENTITY_INVENTORY_TOOL_IDS),
        ...DATA_EXPLORATION_TOOL_IDS,
      ])
    );
  });

  it.each([ENTITY_INVENTORY_INFERENCE_FEATURE_ID, DEFINITION_AUTHORING_INFERENCE_FEATURE_ID])(
    'inference feature id "%s" matches the model management rule',
    (id) => {
      // `search_inference_endpoints/server/utils/validate_feature.ts`: lowercase, digits, underscores.
      expect(id).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  );

  it('skill is allow-listed, valid, and exposes every tool', async () => {
    const skill = createDefinitionAuthoringSkill();
    expect(skill.id).toBe(DEFINITION_AUTHORING_SKILL_ID);
    expect(isAllowedBuiltinSkill(skill.id)).toBe(true);
    await expect(validateSkillDefinition(skill)).resolves.toBe(skill);
    expect(skill.description.length).toBeLessThanOrEqual(1024);
    const tools = await skill.getRegistryTools?.();
    expect(tools).toEqual(
      expect.arrayContaining([
        ...Object.values(ENTITY_INVENTORY_TOOL_IDS),
        ...DATA_EXPLORATION_TOOL_IDS,
      ])
    );
    // The Tools section of the skill names the ids the agent must call.
    for (const id of Object.values(ENTITY_INVENTORY_TOOL_IDS)) {
      expect(skill.content).toContain(`\`${id}\``);
    }
  });
});
