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
import { describeDefinitionError, toDefinitionDocument } from './shape';

const MAX_TYPE_LENGTH = 128;

const schema = z.object({
  type: z
    .string()
    .min(1)
    .max(MAX_TYPE_LENGTH)
    .describe('The entity type name, e.g. "k8s.pod" or the built-in "host".'),
});

export const createGetDefinitionTool = ({
  getDefinitionRegistry,
}: AgentBuilderToolDeps): BuiltinToolDefinition<typeof schema> => ({
  id: ENTITY_INVENTORY_TOOL_IDS.getDefinition,
  type: ToolType.builtin,
  description: `Returns the full current definition record of one entity type in the current space. Use it before changing a type (the returned document is exactly what save_definition accepts with replace: true), or when the user asks what a type currently declares.

Returns: type, kind ("definition": an API definition, returned without its id; "extension": a built-in with an API inventory extension, returned as { extends, inventory }; "read_only": a built-in without an API extension or a code-registered definition, with readOnlyReason), source, inventorySource, createdAt, updatedAt and the document. Returns a not-found error when no such type is registered; list_types shows the available names.`,
  tags: ['observability', 'entity-inventory'],
  annotations: {
    title: 'Get entity definition',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  schema,
  handler: async ({ type }, { spaceId }) => {
    try {
      const registry = await getDefinitionRegistry(spaceId);
      const record = await registry.getDefinition(type);
      if (!record) {
        return {
          results: [
            createErrorResult({
              message: `No entity definition of type "${type}" is registered in space "${spaceId}"`,
              metadata: {
                kind: 'not_found',
                hint: 'Call list_types to see the registered types, or create the type with save_definition.',
              },
            }),
          ],
        };
      }
      return { results: [createOtherResult(toDefinitionDocument(record))] };
    } catch (error) {
      const { message, kind, hint } = describeDefinitionError(error);
      return {
        results: [
          createErrorResult({
            message: `Could not read the definition of "${type}": ${message}`,
            metadata: { kind, ...(hint ? { hint } : {}) },
          }),
        ],
      };
    }
  },
});
