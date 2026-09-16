/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { defineSkillType } from '@kbn/agent-builder-server/skills/type_definition';
import { DEFINITION_AUTHORING_SKILL_ID, DEFINITION_AUTHORING_TOOL_IDS } from '../../tool_ids';
import definitionAuthoringDescription from './description.text';
import definitionAuthoringContent from './skill.md.text';

/** The authoring rules for entity inventory definitions, with the tools that implement each step. */
export const createDefinitionAuthoringSkill = () =>
  defineSkillType({
    id: DEFINITION_AUTHORING_SKILL_ID,
    name: 'entity-inventory-definitions',
    basePath: 'skills/observability',
    description: definitionAuthoringDescription.trim(),
    content: definitionAuthoringContent,
    getRegistryTools: () => [...DEFINITION_AUTHORING_TOOL_IDS],
    experimental: false,
  });
