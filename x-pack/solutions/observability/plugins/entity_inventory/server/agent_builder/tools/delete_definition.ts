/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod/v4';
import { i18n } from '@kbn/i18n';
import { ToolType } from '@kbn/agent-builder-common';
import {
  createErrorResult,
  createOtherResult,
  type BuiltinToolDefinition,
} from '@kbn/agent-builder-server';
import { ENTITY_INVENTORY_TOOL_IDS } from '../tool_ids';
import type { AgentBuilderToolDeps } from '../types';
import { describeDefinitionError } from './shape';

const MAX_TYPE_LENGTH = 128;

const schema = z.object({
  type: z
    .string()
    .min(1)
    .max(MAX_TYPE_LENGTH)
    .describe(
      'The entity type to delete. For a built-in type (host, service, user, generic) this removes its API-registered inventory extension and keeps the type.'
    ),
});

export const createDeleteDefinitionTool = ({
  getDefinitionsClient,
  logger,
}: AgentBuilderToolDeps): BuiltinToolDefinition<typeof schema> => ({
  id: ENTITY_INVENTORY_TOOL_IDS.deleteDefinition,
  type: ToolType.builtin,
  description: `Deletes an API-registered entity definition from the current space, or, for a built-in type, its API-registered inventory extension. This tool is DESTRUCTIVE: call it only when the user explicitly asks to delete or remove a type or extension. Code-registered definitions and extensions, and built-ins without an API extension, cannot be deleted (the result says so).

Returns the deleted type on success, or a not-found / conflict error with a hint.

**Cancellation:** if the result says the user chose not to proceed, stop, acknowledge, and ask how to continue. Do NOT retry.`,
  tags: ['observability', 'entity-inventory'],
  annotations: {
    title: 'Delete entity definition',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  schema,
  confirmation: {
    askUser: 'always',
    getConfirmation: ({ toolParams }) => ({
      title: i18n.translate('xpack.entityInventory.agentBuilder.delete.title', {
        defaultMessage: 'Delete the entity definition "{type}"',
        values: { type: toolParams.type },
      }),
      message: i18n.translate('xpack.entityInventory.agentBuilder.delete.message', {
        defaultMessage:
          'The definition of "{type}" (or, for a built-in type, its inventory extension) is removed from this space. The inventory stops listing this type.',
        values: { type: toolParams.type },
      }),
      confirm_text: i18n.translate('xpack.entityInventory.agentBuilder.delete.button', {
        defaultMessage: 'Delete',
      }),
      color: 'danger' as const,
    }),
  },
  handler: async ({ type }, { request }) => {
    try {
      const client = await getDefinitionsClient(request);
      await client.delete(type);
      return { results: [createOtherResult({ action: 'deleted', type })] };
    } catch (error) {
      const { message, kind, hint } = describeDefinitionError(error);
      if (kind === 'unexpected') {
        logger.error(`Entity definition delete of "${type}" failed: ${message}`);
      }
      return {
        results: [
          createErrorResult({
            message: `Could not delete "${type}": ${message}`,
            metadata: { kind, ...(hint ? { hint } : {}) },
          }),
        ],
      };
    }
  },
});
