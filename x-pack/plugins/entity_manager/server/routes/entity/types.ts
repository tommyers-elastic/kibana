/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { schema, TypeOf } from '@kbn/config-schema';
import { createEntityManagerServerRoute } from '../create_entity_manager_server_route';
import { createObservabilityEsClient } from '@kbn/observability-utils/es/client/create_observability_es_client';
import { ENTITY_DEFINITIONS_INDEX } from '@kbn/entityManager-plugin/common/constants_entities';
import { EntityDefinition } from '@kbn/entities-schema';

const listResponse = () => {
    return schema.arrayOf(schema.object({
        type: schema.string(),
        description: schema.string(),
    }));
}

type ListResponse = TypeOf<typeof listResponse>

export const listEntityTypesRoute = createEntityManagerServerRoute({
    endpoint: 'GET /internal/entity',
    handler: async ({ context, response, logger }) => {
      const core = await context.core;

      const esClient = createObservabilityEsClient({
        client: core.elasticsearch.client.asCurrentUser,
        logger: logger,
        plugin: `@kbn/entity-manager-plugin`,
      });

      const res = await esClient.search<EntityDefinition>('get_all_entity_definitions', {
        index: ENTITY_DEFINITIONS_INDEX,
        size: 1000,
        track_total_hits: false,
    })

      return response.ok({ body: res.hits.hits
        .map((doc) => { return { type: doc._source.type, description: doc._source.description, metadata: doc._source.metadata } })
      });
    },
  });
