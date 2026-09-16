/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { HttpStart } from '@kbn/core/public';
import type { EntityDefinitionRecord } from '@kbn/entity-store/common';
import type { DefinitionDocument } from './editable_document';

export const DEFINITIONS_API_PATH = '/internal/entity_store/definitions';
const DEFINITIONS_API_VERSION = '2';

export interface DefinitionsListResponse {
  definitions: EntityDefinitionRecord[];
}

export interface DefinitionsApi {
  list(): Promise<DefinitionsListResponse>;
  create(document: DefinitionDocument): Promise<EntityDefinitionRecord>;
  replace(type: string, document: DefinitionDocument): Promise<EntityDefinitionRecord>;
  remove(type: string): Promise<void>;
}

const typePath = (type: string): string => `${DEFINITIONS_API_PATH}/${encodeURIComponent(type)}`;

/** Thin client over the entity store definitions API (`elastic-api-version: 2`). */
export const createDefinitionsApi = (http: HttpStart): DefinitionsApi => ({
  list: () =>
    http.get<DefinitionsListResponse>(DEFINITIONS_API_PATH, { version: DEFINITIONS_API_VERSION }),
  create: (document) =>
    http.post<EntityDefinitionRecord>(DEFINITIONS_API_PATH, {
      version: DEFINITIONS_API_VERSION,
      body: JSON.stringify(document),
    }),
  // `force` lets an identity change through; it is ignored for extension documents.
  replace: (type, document) =>
    http.put<EntityDefinitionRecord>(typePath(type), {
      version: DEFINITIONS_API_VERSION,
      query: { force: true },
      body: JSON.stringify(document),
    }),
  remove: async (type) => {
    await http.delete(typePath(type), { version: DEFINITIONS_API_VERSION });
  },
});
