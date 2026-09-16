/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { HttpStart } from '@kbn/core/public';
import {
  ENTITY_INVENTORY_ROUTES,
  type InventoryDocumentCountsResponse,
  type InventoryListResponse,
  type InventoryTypesResponse,
} from '../../common';

export interface InventoryRangeRequest {
  from: string;
  to: string;
}

export interface InventoryListRequest extends InventoryRangeRequest {
  limit: number;
}

export interface InventoryApi {
  types(): Promise<InventoryTypesResponse>;
  list(type: string, body: InventoryListRequest): Promise<InventoryListResponse>;
  /** Every document of the sources' indices in the window, before any predicate; separate from `_list`. */
  documentCounts(
    type: string,
    body: InventoryRangeRequest
  ): Promise<InventoryDocumentCountsResponse>;
}

const typeRoute = (route: string, type: string): string =>
  route.replace('{type}', encodeURIComponent(type));

/** Client for this plugin's own (unversioned, internal) inventory routes. */
export const createInventoryApi = (http: HttpStart): InventoryApi => ({
  types: () => http.get<InventoryTypesResponse>(ENTITY_INVENTORY_ROUTES.TYPES),
  list: (type, body) =>
    http.post<InventoryListResponse>(typeRoute(ENTITY_INVENTORY_ROUTES.LIST, type), {
      body: JSON.stringify(body),
    }),
  documentCounts: (type, body) =>
    http.post<InventoryDocumentCountsResponse>(
      typeRoute(ENTITY_INVENTORY_ROUTES.DOCUMENT_COUNTS, type),
      { body: JSON.stringify(body) }
    ),
});
