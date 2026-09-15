/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod/v4';

/**
 * The four built-in, code-defined Security entity types. They are reserved names: the definitions
 * API cannot create, replace or delete them, and they are the only types with engines (extraction
 * tasks, component templates, install/start/stop steps, CRUD writes).
 *
 * Dependency-free on purpose: this module is re-exported from the page-load `common` barrel.
 */
export type BuiltInEntityType = z.infer<typeof BuiltInEntityType>;
export const BuiltInEntityType = z.enum(['user', 'host', 'service', 'generic']);

/** Enum order, not object-key order: index template `composed_of` is order-sensitive. */
export const ALL_BUILT_IN_ENTITY_TYPES: readonly BuiltInEntityType[] = Object.values(
  BuiltInEntityType.enum
);

const BUILT_IN_ENTITY_TYPE_SET: ReadonlySet<string> = new Set(ALL_BUILT_IN_ENTITY_TYPES);

/** Whether `type` names one of the four built-in Security types. */
export function isBuiltInEntityType(type: string): type is BuiltInEntityType {
  return BUILT_IN_ENTITY_TYPE_SET.has(type);
}
