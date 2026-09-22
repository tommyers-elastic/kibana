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
import { InventoryDefinitionError } from '../../inventory/generator';
import { InventoryRequestError, InventoryTypeNotFoundError } from '../../inventory/executor';
import { ENTITY_INVENTORY_TOOL_IDS } from '../tool_ids';
import type { AgentBuilderToolDeps } from '../types';
import { describeDefinitionError, shapePreview } from './shape';

const MAX_TYPE_LENGTH = 128;
const DEFAULT_MINUTES = 15;
const MAX_MINUTES = 24 * 60;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

const schema = z.object({
  type: z.string().min(1).max(MAX_TYPE_LENGTH).describe('The entity type to list, e.g. "k8s.pod".'),
  minutes: z
    .number()
    .int()
    .min(1)
    .max(MAX_MINUTES)
    .default(DEFAULT_MINUTES)
    .describe(
      `Window length in minutes ending now (default ${DEFAULT_MINUTES}, the inventory UI default; max ${MAX_MINUTES}). Lists are liveness queries: keep it short.`
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .describe(
      `Maximum rows to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}); the total is exact regardless.`
    ),
});

/** `[now - minutes, now]` as the absolute ISO instants the inventory service requires. */
export const windowEndingNow = (
  minutes: number,
  now = new Date()
): { from: string; to: string } => ({
  from: new Date(now.getTime() - minutes * 60_000).toISOString(),
  to: now.toISOString(),
});

export const createPreviewInventoryTool = ({
  getInventoryService,
  logger,
}: AgentBuilderToolDeps): BuiltinToolDefinition<typeof schema> => ({
  id: ENTITY_INVENTORY_TOOL_IDS.previewInventory,
  type: ToolType.builtin,
  description: `Runs the entity inventory list for one type over the last N minutes, exactly as the inventory UI does, and returns what the definition produces. Always call it right after creating or replacing a definition, and whenever the user asks why entities or columns are missing.

Returns: total (exact distinct entity count across sources), truncated, the returned rows (each carries every output column, null when no source produced it), the columns (name, kind, unit, ES type), one entry per source query in queries[] with its index, engine ("TS" or "FROM", plus one "COUNT" query), ES took, documentsFound, row count and the generated ES|QL, errors[] (sources that failed or matched no index), unavailableColumns[] (declared fields mapped nowhere in a source) and provenance (which source supplied each merged value per entity id).

Read back: rows from every intended source in queries[], no errors[], unavailableColumns[] only where a pipeline genuinely lacks a field. Returns a clear error when the inventory is disabled or the type has no inventory extension.`,
  tags: ['observability', 'entity-inventory'],
  annotations: {
    title: 'Preview entity inventory',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  schema,
  handler: async ({ type, minutes, limit }, { request }) => {
    const window = windowEndingNow(minutes);
    try {
      const service = await getInventoryService(request);
      const response = await service.list(type, { ...window, limit });
      return { results: [createOtherResult(shapePreview(response, window))] };
    } catch (error) {
      if (error instanceof InventoryTypeNotFoundError) {
        return {
          results: [
            createErrorResult({
              message: error.message,
              metadata: {
                kind: 'not_found',
                hint: 'Only types with an inventory extension can be previewed; list_types shows them.',
              },
            }),
          ],
        };
      }
      if (error instanceof InventoryRequestError || error instanceof InventoryDefinitionError) {
        return {
          results: [
            createErrorResult({ message: error.message, metadata: { kind: 'validation' } }),
          ],
        };
      }
      const { message, kind, hint } = describeDefinitionError(error);
      if (kind === 'unexpected') {
        logger.error(`Entity inventory preview of "${type}" failed: ${message}`);
      }
      return {
        results: [
          createErrorResult({
            message: `Could not preview "${type}": ${message}`,
            metadata: {
              kind,
              ...(hint ? { hint } : {}),
              ...(kind === 'forbidden'
                ? {
                    hint: 'The entity inventory is disabled in this Kibana (ui setting "entityInventory:enabled"); definitions can still be authored but not previewed.',
                  }
                : {}),
            },
          }),
        ],
      };
    }
  },
});
