/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

// this is the real meat here, the rest shouldn't really be in this file
function mergeRecords(
    record1: Record<string, any>, 
    record2: Record<string, any>
): Record<string, any> {
    const merged: Record<string, any> = { ...record1 }; 

    for (const [key, value] of Object.entries(record2)) {
        if (merged.hasOwnProperty(key)) {
            merged[key] = Array.isArray(merged[key])
                ? [...merged[key], value]          
                : [merged[key], value];           
        } else {
            merged[key] = value;
        }
    }

    return merged;
}

function removeNullFields(record: Record<string, any>): Record<string, any> {
    return Object.fromEntries(
        Object.entries(record)
            .filter(([_, value]) => value !== null)
    );
}


export function mergeListResults(
    results: Record<string, any>[],
): Record<string, any>[] {
    const instances = new Map<string, Record<string, any>>();

    results.forEach((res) => {
        const entityId = Object.entries(res)
            .filter(([key, _]) => !key.startsWith("metadata."))
            .filter(([key, _]) => !key.startsWith("entity."))
            .map(([_, value]) => value)
            .filter(Boolean)
            .join(":");
        
        if (entityId === "") {
            return;
        }
        
        if (instances.has(entityId)) {
            instances.set(entityId, mergeRecords(
                instances.get(entityId)!!,
                removeNullFields(res),
            ));
        } else {
            instances.set(entityId, {
                "entity.id": entityId,
                ...removeNullFields(res),
            })
        }
    })

    return Array.from(instances.values());
}
