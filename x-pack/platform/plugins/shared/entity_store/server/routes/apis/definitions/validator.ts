/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod/v4';
import {
  entityDefinitionInputSchema,
  entityTypeNameSchema,
} from '../../../../common/domain/definitions/entity_schema';

export type DefinitionTypeParams = z.infer<typeof DefinitionTypeParams>;
export const DefinitionTypeParams = z.object({
  type: entityTypeNameSchema,
});

export type ListDefinitionsQuery = z.infer<typeof ListDefinitionsQuery>;
export const ListDefinitionsQuery = z.object({
  mode: z.enum(['none', 'extraction']).optional(),
});

export type ReplaceDefinitionQuery = z.infer<typeof ReplaceDefinitionQuery>;
export const ReplaceDefinitionQuery = z.object({
  /** Required to replace a definition when the change alters its identity. */
  force: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

/** The spec-1 definition without the runtime `id`; materialisation must be absent or `mode: 'none'`. */
export type DefinitionBody = z.infer<typeof DefinitionBody>;
export const DefinitionBody = entityDefinitionInputSchema;
