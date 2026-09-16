/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

export { resolveIdentityPlan, type IdentityPlan } from './identity';
export { buildColumns, sourceColumnNames, getInventory, InventoryDefinitionError } from './columns';
export { buildSourceQuery, metricExpression, metricPresenceFilter } from './source_query';
export { buildCountQuery, COUNT_COLUMN } from './count_query';
export { validateSourceFilter } from './filters';
export { quoteIdentifier, isSafeIndexPattern } from './esql_syntax';
export type {
  GeneratedQuery,
  NamedParams,
  SourcePlan,
  SourceQueryOptions,
  TimeRange,
} from './types';
