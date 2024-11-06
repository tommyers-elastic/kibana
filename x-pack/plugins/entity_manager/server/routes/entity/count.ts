/*
* Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
* or more contributor license agreements. Licensed under the Elastic License
* 2.0; you may not use this file except in compliance with the Elastic License
* 2.0.
*/

import { schema, TypeOf } from '@kbn/config-schema';
import { createEntityManagerServerRoute } from '../create_entity_manager_server_route';
import { createObservabilityEsClient } from '@kbn/observability-utils/es/client/create_observability_es_client';
import { z } from '@kbn/zod';
import { getCountEntityInstancesQueries } from '../../lib/queries/count';
import { ENTITY_DEFINITIONS_INDEX } from '@kbn/entityManager-plugin/common/constants_entities';
import { esqlResultToPlainObjects } from '@kbn/observability-utils/es/utils/esql_result_to_plain_objects';
import { EntityDefinition } from '../../schemas/entity_definition';
import { SearchRequest } from '@elastic/elasticsearch/lib/api/types';

// const countResponse = () => {
//     return schema.arrayOf(schema.object({
//         type: schema.string(),
//         count: schema.string(),
//     }));
// }

// type CountResponse = TypeOf<typeof countResponse>

export const countEntitiesRoute = createEntityManagerServerRoute({
    endpoint: 'GET /internal/entity/{type}/count',
    params: z.object({
        path: z.object({ type: z.string() }),
        query: z.object({
            filterKql: z.optional(z.string()),
            filterEsql: z.optional(z.string()),
        }),
    }),
    handler: async ({ context, params, response, logger }) => {
        const core = await context.core;

        const esClient = createObservabilityEsClient({
            client: core.elasticsearch.client.asCurrentUser,
            logger: logger,
            plugin: `@kbn/entity-manager-plugin`,
        });

        const res = await esClient.search('get_entity_definition_by_type', {
            index: ENTITY_DEFINITIONS_INDEX,
            size: 1,
            track_total_hits: true,
            query: {
                term: {
                    type: params.path.type
                }
            }
        })

        if (res.hits.total.value != 1) {
            // error
            return response.customError({ statusCode: 500 })
        }

        const queries = getCountEntityInstancesQueries(
            res.hits.hits[0]._source as EntityDefinition,
            params.query.filterEsql
        );
        const queryResults = new Array(queries.length);

        await Promise.all(
          queries.map((query, idx) =>
            esClient.esql('get_entity_instance_count', {
                query,
            }).then((res) =>  {
                queryResults[idx] = res;
            })
          )
        );

        return response.ok({ body: queryResults });
    },
});

// function esqlResultToEntityDefinition(): EntityDefinition {
    
// }