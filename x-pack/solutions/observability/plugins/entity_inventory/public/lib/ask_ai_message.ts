/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { DefinitionDocument } from './editable_document';
import { stringifyDocument } from './editable_document';

/** Agent id and session tag of the dedicated definition authoring conversation. */
export const DEFINITION_AUTHORING_AGENT_ID = 'observability.entity-inventory-definitions';
export const DEFINITION_AUTHORING_SESSION_TAG = 'entity-inventory-definitions';

/** The opening message of an "Ask AI about this definition" conversation: the document as a JSON block. */
export const buildAskAiMessage = (type: string, document: DefinitionDocument): string =>
  `Here is the current definition of \`${type}\`:\n\`\`\`json\n${stringifyDocument(
    document
  )}\n\`\`\``;
