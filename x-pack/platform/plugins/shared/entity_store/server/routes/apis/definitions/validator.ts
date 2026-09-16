/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod/v4';
import { entityTypeNameSchema } from '../../../../common/domain/definitions/entity_schema';
import { entityDefinitionsApiBodySchema } from '../../../../common/domain/definitions/definitions_api_body';

const booleanQueryParam = z.enum(['true', 'false']).transform((value) => value === 'true');

export type DefinitionTypeParams = z.infer<typeof DefinitionTypeParams>;
export const DefinitionTypeParams = z.object({
  type: entityTypeNameSchema,
});

export type ListDefinitionsQuery = z.infer<typeof ListDefinitionsQuery>;
export const ListDefinitionsQuery = z.object({
  mode: z.enum(['none', 'extraction']).optional(),
  /** Only definitions with an inventory extension (built-ins with a registered extension included). */
  inventory: booleanQueryParam.optional(),
});

export type ReplaceDefinitionQuery = z.infer<typeof ReplaceDefinitionQuery>;
export const ReplaceDefinitionQuery = z.object({
  /** Required to replace a definition when the change alters its identity; ignored for extension documents. */
  force: booleanQueryParam.optional(),
});

/**
 * Either a spec-1 definition without the runtime `id` (`type`; materialisation absent or
 * `mode: 'none'`) or a built-in inventory extension document (`extends`).
 */
export type DefinitionBody = z.infer<typeof DefinitionBody>;
export const DefinitionBody = entityDefinitionsApiBodySchema;
