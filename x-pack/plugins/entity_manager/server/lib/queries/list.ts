/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

// import { ElasticsearchClient, Logger } from '@kbn/core/server';
// import { EntityDefinition } from '@kbn/entities-schema';
// import { retryTransientEsErrors } from './helpers/retry';
// import { generateLatestTransform } from './transform/generate_latest_transform';

import { EntityDefinition } from "../../schemas/entity_definition";

export function getListEntityInstancesQueries(
    entity: EntityDefinition,
    filter?: string,
    metadata?: string,
): string[] {
    const queries = entity.sources.map((source) => {
        let query = `FROM ${source.index_patterns} |\n`;

        if (filter !== undefined) {
            query += `WHERE ${filter} |`
        }

        const metadata_aggs = new Array<string>();

        // default 'last seen' attribute
        metadata_aggs.push('entity.lastSeenTimestamp=MAX(@timestamp)');

        if (source.metadata_fields !== undefined) {
            metadata_aggs.push(...source.metadata_fields
                .map((md) => `metadata.${md.name}=VALUES(${md.field})`));
        }

        if (metadata !== undefined) {
            metadata_aggs.push(...metadata.split(',')
                .map((field) => `metadata.${field}=VALUES(${field})`));
        }

        query += `STATS ${metadata_aggs.join(', ')} BY ${source.identity_fields.join(',')}`

        return query
    })

    return queries
}
