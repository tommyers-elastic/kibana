/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/** UI setting (API-only, hidden from the advanced settings UI) gating every inventory route. */
export const ENTITY_INVENTORY_ENABLED_SETTING = 'entityInventory:enabled';

export const ENTITY_INVENTORY_API_BASE = '/internal/entity_inventory';

export const ENTITY_INVENTORY_ROUTES = {
  TYPES: `${ENTITY_INVENTORY_API_BASE}/types`,
  LIST: `${ENTITY_INVENTORY_API_BASE}/entities/{type}/_list`,
  DETAIL: `${ENTITY_INVENTORY_API_BASE}/entities/{type}/_detail`,
  COUNT: `${ENTITY_INVENTORY_API_BASE}/entities/{type}/_count`,
} as const;

/** ES|QL returns at most this many rows per query; the caller's `limit` is capped to it. */
export const ESQL_MAX_ROWS = 10_000;
export const DEFAULT_LIST_LIMIT = 100;

/** Name of the entity id column on every row. */
export const ENTITY_ID_COLUMN = 'entity.id';
/** Name of the newest-document timestamp column on every row. */
export const LAST_SEEN_COLUMN = 'last_seen';

export type InventoryEngine = 'TS' | 'FROM';

export type InventoryColumnKind = 'entity_id' | 'identity' | 'attribute' | 'metric' | 'last_seen';

/** One output column of a list or detail row, in display order. */
export interface InventoryColumn {
  name: string;
  kind: InventoryColumnKind;
  /** ES|QL column type as returned by the first source that produced it, when known. */
  esType?: string;
  /** The declared field behind an attribute or metric (per-source ones list every variant). */
  fields?: string[];
}

/** How a type identifies entities: the authored tuple, or the built-in type's field ranking. */
export interface InventoryIdentityDescriptor {
  kind: 'tuple' | 'ranking';
  fields: string[];
}

export interface InventoryTypeDescriptor {
  type: string;
  label: string;
  identity: InventoryIdentityDescriptor;
  columns: InventoryColumn[];
  sources: Array<{ index: string; filter?: string }>;
  /** Where the definition came from ('built_in' | 'code' | 'api'), and for built-ins where the extension came from. */
  definitionSource: string;
  inventorySource?: string;
}

export interface InventoryTypesResponse {
  types: InventoryTypeDescriptor[];
}

export type InventorySortDirection = 'asc' | 'desc';

export interface InventorySort {
  column: string;
  direction: InventorySortDirection;
}

/** A query the executor ran (or tried to run), returned for debuggability. */
export interface InventoryQueryInfo {
  /** Index pattern of the source, or `*` for the cross-source count. */
  index: string;
  engine: InventoryEngine | 'COUNT';
  esql: string;
  params?: Record<string, unknown>;
  tookMs?: number;
  documentsFound?: number;
  rows?: number;
  /** The query returned the ES|QL row cap, so this source may have more entities than returned. */
  capped?: boolean;
}

export interface InventorySourceError {
  index: string;
  message: string;
  statusCode?: number;
}

/** A declared attribute or metric whose field is mapped nowhere in the source pattern. */
export interface InventoryUnavailableColumn {
  index: string;
  column: string;
  field: string;
}

export type InventoryRow = Record<string, unknown>;

export interface InventoryListResponse {
  type: string;
  columns: InventoryColumn[];
  rows: InventoryRow[];
  /** Exact distinct entity count across sources for the window, or null if the count query failed. */
  total: number | null;
  truncated: boolean;
  tookMs: number;
  /** Sum of ES `took` over every query that ran (cluster work, not wall time). */
  esTookMs: number;
  queries: InventoryQueryInfo[];
  unavailableColumns: InventoryUnavailableColumn[];
  errors: InventorySourceError[];
}

export interface InventoryCountResponse {
  type: string;
  count: number | null;
  tookMs: number;
  esTookMs: number;
  queries: InventoryQueryInfo[];
  errors: InventorySourceError[];
}
