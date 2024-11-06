/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { EntityDefinition } from "../../schemas/entity_definition";

export function getCountEntityInstancesQueries(
    entity: EntityDefinition,
    filter?: string
): string[] {
    const queries = entity.sources.map((source) => {
        let query = `FROM ${source.index_patterns} |\n`;

        if (filter !== undefined) {
            query += `WHERE ${filter} |`
        }

        source.identity_fields.forEach((identityField) => {
            query += `WHERE ${identityField} IS NOT NULL |\n`
        })

        query += `STATS COUNT_DISTINCT(${source.identity_fields.join(',')})`
        return query
    })
    
    return queries
}
