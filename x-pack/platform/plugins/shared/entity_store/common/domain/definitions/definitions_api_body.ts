/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { isPlainObject } from 'lodash';
import { z } from '@kbn/zod/v4';
import { entityDefinitionInputSchema, type EntityDefinitionWithoutId } from './entity_schema';
import {
  builtInInventoryExtensionDocumentSchema,
  type BuiltInInventoryExtensionDocument,
} from './inventory_schema';

/** A document accepted by the definitions API and the setup contract: a full definition or an extension. */
export type EntityDefinitionsApiBody =
  | EntityDefinitionWithoutId
  | BuiltInInventoryExtensionDocument;

const DOCUMENT_KIND_HINT =
  'a document is either a full entity definition (with "type") or an inventory extension of a built-in type (with "extends")';

/**
 * The definitions API body: a full definition (`entityDefinitionInputSchema`, identity required) or
 * a built-in inventory extension document (`builtInInventoryExtensionDocumentSchema`). The kind is
 * decided by the presence of `type` / `extends` before parsing so a failure reports the issues of
 * the intended kind, not a union of both. The output is the parsed document itself (no wrapper), so
 * `DeepStrict` can compare input and output keys.
 */
export const entityDefinitionsApiBodySchema = z
  .unknown()
  .transform((body, ctx): EntityDefinitionsApiBody => {
    if (!isPlainObject(body)) {
      ctx.addIssue({ code: 'custom', message: `expected an object: ${DOCUMENT_KIND_HINT}` });
      return z.NEVER;
    }
    const document = body as Record<string, unknown>;
    const hasType = 'type' in document;
    const hasExtends = 'extends' in document;
    if (hasType && hasExtends) {
      ctx.addIssue({
        code: 'custom',
        message: `"type" and "extends" cannot both be set: ${DOCUMENT_KIND_HINT}`,
      });
      return z.NEVER;
    }
    if (!hasType && !hasExtends) {
      ctx.addIssue({
        code: 'custom',
        message: `either "type" or "extends" is required: ${DOCUMENT_KIND_HINT}`,
      });
      return z.NEVER;
    }
    const result = hasExtends
      ? builtInInventoryExtensionDocumentSchema.safeParse(document)
      : entityDefinitionInputSchema.safeParse(document);
    if (!result.success) {
      for (const { path, message, input } of result.error.issues) {
        ctx.addIssue({ code: 'custom', path, message, input });
      }
      return z.NEVER;
    }
    return result.data;
  });
