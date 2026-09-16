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
import { entityDefinitionsApiBodySchema } from '@kbn/entity-store/server';
import { ENTITY_INVENTORY_TOOL_IDS } from '../tool_ids';
import type { AgentBuilderToolDeps } from '../types';
import {
  describeDefinitionError,
  formatIssues,
  getDocumentType,
  summarizeDocument,
  toDefinitionDocument,
} from './shape';

const MAX_DOCUMENT_KEYS = 64;

const schema = z.object({
  document: z
    .record(z.string().max(128), z.unknown())
    .refine((document) => Object.keys(document).length <= MAX_DOCUMENT_KEYS, {
      message: `a document has at most ${MAX_DOCUMENT_KEYS} top-level keys`,
    })
    .describe(
      'The definition document as a JSON object: either a full definition ({ "type", "name", "identityField", "materialisation": { "mode": "none" }, "inventory": { "label", "identity", "attributes", "sources" } }) or an extension of a built-in type ({ "extends": "host" | "service" | "user" | "generic", "inventory": { "label", "attributes", "sources" } }). Never include an "id".'
    ),
  replace: z
    .boolean()
    .default(false)
    .describe(
      'false (default) creates the type and fails when it already exists; true replaces the existing definition of the same type (or creates or replaces the extension of a built-in).'
    ),
  force: z
    .boolean()
    .default(false)
    .describe(
      'Only with replace: true. Allows a replace that changes the identity (identityField / inventory.identity), which renames every entity id of the type. Set it only after the user has explicitly accepted that.'
    ),
});

export const createSaveDefinitionTool = ({
  getDefinitionsClient,
  logger,
}: AgentBuilderToolDeps): BuiltinToolDefinition<typeof schema> => ({
  id: ENTITY_INVENTORY_TOOL_IDS.saveDefinition,
  type: ToolType.builtin,
  description: `Persists an entity inventory definition or a built-in type's inventory extension in the current space. This tool MUTATES state: call it only once the user has agreed to the document, after you inspected the data the definition refers to, and always run preview_inventory on the type afterwards.

The document is validated with the definitions API schema first; on failure the result lists the issues (path and message) so you can fix the document and try again, nothing is written. On success it returns the stored record (type, kind, source, updatedAt) in the same shape get_definition returns.

replace: false creates (conflict when the type exists; then use replace: true). replace: true replaces the definition of the same type (not found when it does not exist) or creates or replaces the extension of a built-in. A replace that changes the identity is refused with a conflict unless force: true; explain to the user that every entity id changes before forcing. Built-in types (host, service, user, generic) can only be extended, never defined; code-registered definitions and extensions cannot be changed.

**Cancellation:** if the result says the user chose not to proceed, stop, acknowledge, and ask how to continue. Do NOT retry.`,
  tags: ['observability', 'entity-inventory'],
  annotations: {
    title: 'Create or replace entity definition',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  schema,
  confirmation: {
    askUser: 'always',
    getConfirmation: ({ toolParams }) => {
      const { document, replace, force } = toolParams;
      const type = getDocumentType(document) ?? '?';
      return {
        title: replace
          ? i18n.translate('xpack.entityInventory.agentBuilder.saveDefinition.replaceTitle', {
              defaultMessage: 'Replace the entity definition "{type}"',
              values: { type },
            })
          : i18n.translate('xpack.entityInventory.agentBuilder.saveDefinition.createTitle', {
              defaultMessage: 'Create the entity definition "{type}"',
              values: { type },
            }),
        message: [
          summarizeDocument(document),
          ...(force
            ? [
                i18n.translate('xpack.entityInventory.agentBuilder.saveDefinition.forceNote', {
                  defaultMessage:
                    '**Identity changes are forced**: every entity id of this type is renamed.',
                }),
              ]
            : []),
        ].join('\n\n'),
        confirm_text: replace
          ? i18n.translate('xpack.entityInventory.agentBuilder.saveDefinition.replaceButton', {
              defaultMessage: 'Replace definition',
            })
          : i18n.translate('xpack.entityInventory.agentBuilder.saveDefinition.createButton', {
              defaultMessage: 'Create definition',
            }),
        color: 'primary' as const,
      };
    },
  },
  handler: async ({ document, replace, force }, { request }) => {
    const parsed = entityDefinitionsApiBodySchema.safeParse(document);
    if (!parsed.success) {
      return {
        results: [
          createErrorResult({
            message: 'The document is not a valid entity definition; nothing was written.',
            metadata: { kind: 'validation', issues: formatIssues(parsed.error.issues) },
          }),
        ],
      };
    }
    const type = getDocumentType(document);
    if (type === undefined) {
      return {
        results: [
          createErrorResult({
            message: 'The document has neither "type" nor "extends"; nothing was written.',
            metadata: { kind: 'validation' },
          }),
        ],
      };
    }
    try {
      const client = await getDefinitionsClient(request);
      const record = replace
        ? await client.replace(type, parsed.data, { force })
        : await client.create(parsed.data);
      return {
        results: [
          createOtherResult({
            action: replace ? 'replaced' : 'created',
            ...toDefinitionDocument(record),
            next: `Run preview_inventory for "${record.definition.type}" and read back queries[], errors[] and unavailableColumns[].`,
          }),
        ],
      };
    } catch (error) {
      const { message, kind, hint } = describeDefinitionError(error);
      if (kind === 'unexpected') {
        logger.error(
          `Entity definition ${replace ? 'replace' : 'create'} of "${type}" failed: ${message}`
        );
      }
      return {
        results: [
          createErrorResult({
            message: `Could not ${replace ? 'replace' : 'create'} "${type}": ${message}`,
            metadata: { kind, ...(hint ? { hint } : {}) },
          }),
        ],
      };
    }
  },
});
