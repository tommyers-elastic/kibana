/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { platformCoreTools } from '@kbn/agent-builder-common/tools';

const TOOL_ID_PREFIX = 'observability.entity_inventory';

/** Ids of the built-in tools this plugin registers; each is allow-listed in `@kbn/agent-builder-server`. */
export const ENTITY_INVENTORY_TOOL_IDS = {
  listTypes: `${TOOL_ID_PREFIX}.list_types`,
  getDefinition: `${TOOL_ID_PREFIX}.get_definition`,
  previewInventory: `${TOOL_ID_PREFIX}.preview_inventory`,
  saveDefinition: `${TOOL_ID_PREFIX}.save_definition`,
  deleteDefinition: `${TOOL_ID_PREFIX}.delete_definition`,
} as const;

/** Platform tools the authoring skill relies on to inspect data before writing a definition. */
export const DATA_EXPLORATION_TOOL_IDS = [
  platformCoreTools.executeEsql,
  platformCoreTools.listIndices,
  platformCoreTools.getIndexMapping,
  platformCoreTools.indexExplorer,
] as const;

export const DEFINITION_AUTHORING_TOOL_IDS: readonly string[] = [
  ...Object.values(ENTITY_INVENTORY_TOOL_IDS),
  ...DATA_EXPLORATION_TOOL_IDS,
];

export const DEFINITION_AUTHORING_SKILL_ID = 'observability.entity-inventory-definitions';
export const DEFINITION_AUTHORING_AGENT_ID = 'observability.entity-inventory-definitions';
export const DEFINITION_AUTHORING_AGENT_TYPE_ID = 'observability.entity-inventory-definitions-type';
