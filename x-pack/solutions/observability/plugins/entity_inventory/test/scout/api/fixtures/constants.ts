/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { tags } from '@kbn/scout-oblt';

const BASE_HEADERS = {
  'kbn-xsrf': 'entity-inventory-scout',
  'x-elastic-internal-origin': 'kibana',
  'Content-Type': 'application/json;charset=UTF-8',
};

/** Headers for the inventory routes (unversioned internal routes). */
export const INVENTORY_HEADERS = BASE_HEADERS;

/** Headers for the entity store definitions API (version 2). */
export const DEFINITIONS_HEADERS = { ...BASE_HEADERS, 'elastic-api-version': '2' };

export const ENTITY_INVENTORY_TAGS = [
  ...tags.stateful.classic,
  ...tags.serverless.observability.complete,
];

export const DEFINITIONS_PATH = 'internal/entity_store/definitions';
export const INVENTORY_PATH = 'internal/entity_inventory';

export const ENTITY_STORE_DYNAMIC_DEFINITIONS_SETTING = 'entityStore:dynamicDefinitionsEnabled';
export const ENTITY_INVENTORY_ENABLED_SETTING = 'entityInventory:enabled';
