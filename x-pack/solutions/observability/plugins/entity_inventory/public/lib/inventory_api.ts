/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { HttpStart } from '@kbn/core/public';
import {
  ENTITY_INVENTORY_ROUTES,
  type InventoryListResponse,
  type InventoryTypesResponse,
} from '../../common';

export interface InventoryListRequest {
  from: string;
  to: string;
  limit: number;
}

export interface InventoryApi {
  types(): Promise<InventoryTypesResponse>;
  list(type: string, body: InventoryListRequest): Promise<InventoryListResponse>;
}

/** Client for this plugin's own (unversioned, internal) inventory routes. */
export const createInventoryApi = (http: HttpStart): InventoryApi => ({
  types: () => http.get<InventoryTypesResponse>(ENTITY_INVENTORY_ROUTES.TYPES),
  list: (type, body) =>
    http.post<InventoryListResponse>(
      ENTITY_INVENTORY_ROUTES.LIST.replace('{type}', encodeURIComponent(type)),
      { body: JSON.stringify(body) }
    ),
});
