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
import { z } from '@kbn/zod';
import { getListEntityInstancesQueries } from '../../lib/queries/list';
import { EntityDefinition } from '../../schemas/entity_definition';
import { mergeListResults } from '../../lib/queries/merge';
import { esqlResultToPlainObjects } from '@kbn/observability-utils/es/utils/esql_result_to_plain_objects';

// const listResponse = () => {
//     return schema.arrayOf(schema.object({
//         type: schema.string(),
//         description: schema.string(),
//     }));
// }

// type ListResponse = TypeOf<typeof listResponse>

export const listEntityInstancesRoute = createEntityManagerServerRoute({
    endpoint: 'GET /internal/entity/{type}/instances',
    params: z.object({
        path: z.object({ type: z.string() }),
        query: z.object({
            filter: z.optional(z.string()),
            metadata: z.optional(z.string()),
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
            // only one definition per type allowed
            return response.customError({ statusCode: 500 })
        }

        console.log(params.query?.metadata);
        const queries = getListEntityInstancesQueries(
            res.hits.hits[0]._source as EntityDefinition,
            params.query?.filter,
            params.query?.metadata,
        );

        logger.debug(`instance queries: ${queries}`);

        const queryResults = new Array(queries.length);

        await Promise.all(
            queries.map((query, idx) =>
                esClient.esql('get_entity_instances', {
                    query,
                }).then((res) => {
                    queryResults[idx] = esqlResultToPlainObjects(res);
                })
            )
        );

        logger.debug(`${queryResults[0][0]}`);

        return response.ok({
            body: mergeListResults([].concat(...queryResults))
        });
    },
});
