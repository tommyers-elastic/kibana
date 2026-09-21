/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod/v4';
import { ToolType } from '@kbn/agent-builder-common';
import {
  createErrorResult,
  createOtherResult,
  type BuiltinToolDefinition,
} from '@kbn/agent-builder-server';
import { ENTITY_INVENTORY_TOOL_IDS } from '../tool_ids';
import type { AgentBuilderToolDeps } from '../types';
import { describeDefinitionError, summarizeEntityType, type EntityTypeSummary } from './shape';

const schema = z.object({
  includeWithoutInventory: z
    .boolean()
    .default(false)
    .describe(
      'Also list registered entity types that have no inventory extension yet (for example a built-in type such as "service" or "user" that could be extended).'
    ),
});

export interface ListEntityTypesResult {
  total: number;
  types: EntityTypeSummary[];
}

export const createListTypesTool = ({
  getDefinitionRegistry,
  logger,
}: AgentBuilderToolDeps): BuiltinToolDefinition<typeof schema> => ({
  id: ENTITY_INVENTORY_TOOL_IDS.listTypes,
  type: ToolType.builtin,
  description: `Lists the entity types registered in the current space that have an entity inventory extension, with what the inventory shows for each. Use it first when the user wants to create, change or debug an entity inventory definition, to know which types exist, which are editable and which fields they already use.

Returns per type: type, label, source ("built_in" | "code" | "api"), inventorySource ("code" | "api", for built-ins carrying an extension), editable ("definition": replace with a "type" document; "extension": replace with an "extends" document; "read_only"), identity (read from identityField: kind "tuple" when one composition of fields is required, "ranking" when several alternatives are tried in order; fields and compositions), top-level attributes, distinct metric names and every source with its index pattern, filter, metric names and per-source attribute names.

Set includeWithoutInventory to true to also see built-in types that could be extended.`,
  tags: ['observability', 'entity-inventory'],
  annotations: {
    title: 'List entity inventory types',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  schema,
  handler: async ({ includeWithoutInventory }, { spaceId }) => {
    try {
      const registry = await getDefinitionRegistry(spaceId);
      const records = await registry.getDefinitions(
        includeWithoutInventory ? {} : { inventory: true }
      );
      const types = records.flatMap((record): EntityTypeSummary[] => {
        try {
          return [summarizeEntityType(record)];
        } catch (error) {
          logger.debug(
            `Skipping entity type "${record.definition.type}" in the agent tool listing: ${
              (error as Error).message
            }`
          );
          return [];
        }
      });
      const result: ListEntityTypesResult = { total: types.length, types };
      return { results: [createOtherResult(result)] };
    } catch (error) {
      const { message, kind, hint } = describeDefinitionError(error);
      return {
        results: [
          createErrorResult({
            message: `Could not list entity types: ${message}`,
            metadata: { kind, ...(hint ? { hint } : {}) },
          }),
        ],
      };
    }
  },
});
