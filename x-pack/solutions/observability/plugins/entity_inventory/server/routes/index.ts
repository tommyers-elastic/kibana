/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { badRequest, notFound } from '@hapi/boom';
import { z } from '@kbn/zod/v4';
import type { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';
import { ENTITY_DEFINITIONS_API_PRIVILEGES } from '@kbn/entity-store/common';
import { ENTITY_INVENTORY_ROUTES } from '../../common';
import { InventoryDefinitionError } from '../inventory/generator';
import { InventoryRequestError, InventoryTypeNotFoundError } from '../inventory/executor';
import { createEntityInventoryServerRoute } from './create_server_route';
import {
  countBodySchema,
  detailBodySchema,
  listBodySchema,
  rangeBodySchema,
  typePathSchema,
} from './schemas';

const readAuthz = {
  authz: { requiredPrivileges: [ENTITY_DEFINITIONS_API_PRIVILEGES.read] },
};

const internal = { access: 'internal' as const };

/** Maps service errors to HTTP statuses; anything else is a 500 with its message. */
const rethrow = (error: unknown): never => {
  if (error instanceof InventoryTypeNotFoundError) {
    throw notFound(error.message);
  }
  if (error instanceof InventoryRequestError || error instanceof InventoryDefinitionError) {
    throw badRequest(error.message);
  }
  throw error;
};

const typesRoute = createEntityInventoryServerRoute({
  endpoint: `GET ${ENTITY_INVENTORY_ROUTES.TYPES}`,
  options: {
    ...internal,
    summary: 'List entity types that have an inventory extension',
    description:
      'Returns every registered entity type carrying an inventory extension with its identity, output columns and sources, so a client can build tables without parsing definitions.',
  },
  security: readAuthz,
  handler: async ({ request, getInventoryService }) => {
    const service = await getInventoryService(request);
    return service.listTypes();
  },
});

const listRoute = createEntityInventoryServerRoute({
  endpoint: `POST ${ENTITY_INVENTORY_ROUTES.LIST}`,
  options: {
    ...internal,
    summary: 'List live entities of a type',
    description:
      'One row per entity seen in the window across the type’s sources, with identity, attributes, metrics, last_seen and entity.id; sortable, truncation-aware, with the generated ES|QL. documentFilter is a query DSL clause applied to documents in every source before aggregation, affecting entity membership, attributes, metrics and total.',
  },
  security: readAuthz,
  params: z.object({ path: typePathSchema, body: listBodySchema }),
  handler: async ({ request, params, getInventoryService }) => {
    const service = await getInventoryService(request);
    const { from, to, limit, sort, documentFilter } = params.body;
    try {
      return await service.list(params.path.type, {
        from,
        to,
        limit,
        sort,
        documentFilter: documentFilter as QueryDslQueryContainer | undefined,
      });
    } catch (error) {
      return rethrow(error);
    }
  },
});

const detailRoute = createEntityInventoryServerRoute({
  endpoint: `POST ${ENTITY_INVENTORY_ROUTES.DETAIL}`,
  options: {
    ...internal,
    summary: 'Detail one entity by its identity values',
    description:
      'The list row shape scoped to the entities matching the given identity field values, over an arbitrary window.',
  },
  security: readAuthz,
  params: z.object({ path: typePathSchema, body: detailBodySchema }),
  handler: async ({ request, params, getInventoryService }) => {
    const service = await getInventoryService(request);
    const { from, to, identity } = params.body;
    try {
      return await service.detail(params.path.type, { from, to, identity });
    } catch (error) {
      return rethrow(error);
    }
  },
});

const countRoute = createEntityInventoryServerRoute({
  endpoint: `POST ${ENTITY_INVENTORY_ROUTES.COUNT}`,
  options: {
    ...internal,
    summary: 'Count live entities of a type',
    description:
      'Exact distinct entity count across the type’s sources for the window. documentFilter is a query DSL clause applied to documents in every source before counting entities.',
  },
  security: readAuthz,
  params: z.object({ path: typePathSchema, body: countBodySchema }),
  handler: async ({ request, params, getInventoryService }) => {
    const service = await getInventoryService(request);
    const { from, to, documentFilter } = params.body;
    try {
      return await service.count(params.path.type, {
        from,
        to,
        documentFilter: documentFilter as QueryDslQueryContainer | undefined,
      });
    } catch (error) {
      return rethrow(error);
    }
  },
});

const documentCountsRoute = createEntityInventoryServerRoute({
  endpoint: `POST ${ENTITY_INVENTORY_ROUTES.DOCUMENT_COUNTS}`,
  options: {
    ...internal,
    summary: 'Count the documents in the window per source of a type',
    description:
      'Diagnostic denominator for the documents a list query processes: all documents in the window for each source pattern, before any predicate. Separate from the list so it never enters its timings.',
  },
  security: readAuthz,
  params: z.object({ path: typePathSchema, body: rangeBodySchema }),
  handler: async ({ request, params, getInventoryService }) => {
    const service = await getInventoryService(request);
    try {
      return await service.documentCounts(params.path.type, params.body);
    } catch (error) {
      return rethrow(error);
    }
  },
});

export const entityInventoryRouteRepository = {
  ...typesRoute,
  ...listRoute,
  ...detailRoute,
  ...countRoute,
  ...documentCountsRoute,
};

export type EntityInventoryRouteRepository = typeof entityInventoryRouteRepository;
