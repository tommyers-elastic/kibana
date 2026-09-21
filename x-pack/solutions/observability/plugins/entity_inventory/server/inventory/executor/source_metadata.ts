/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core/server';
import type { InventoryEngine } from '../../../common';
import { SourceNotFoundError } from './errors';

export interface SourceMetadata {
  /** Concrete indices behind the pattern (data stream backing indices included). */
  indices: string[];
  /** `TS` only when every concrete index is `time_series`; a mixed pattern silently loses rows under `TS`. */
  engine: InventoryEngine;
  /** Declared fields that are mapped in at least one concrete index. */
  mappedFields: Set<string>;
  mappedFieldsByIndex: Map<string, Set<string>>;
}

interface CacheEntry<T> {
  expiresAt: number;
  value: Promise<T>;
}

interface SettingsResponse {
  [index: string]: {
    settings?: { index?: { mode?: string } };
    defaults?: { index?: { mode?: string } };
  };
}

/**
 * A standard index has no explicit `index.mode`; asking for that one setting by name omits such
 * indices from the response entirely, so defaults are requested too and the mode read from either.
 */
const indexMode = (entry: SettingsResponse[string]): string =>
  entry.settings?.index?.mode ?? entry.defaults?.index?.mode ?? 'standard';

interface SourceIndices {
  indices: string[];
  engine: InventoryEngine;
}

interface MetadataRequest {
  index: string;
  fields: string[];
}

/** Shares index resolution and field capabilities across sources while retaining per-source results. */
export class SourceMetadataResolver {
  private readonly indexCache = new Map<string, CacheEntry<SourceIndices>>();
  private readonly fieldCache = new Map<string, CacheEntry<Map<string, Set<string>>>>();

  constructor(private readonly ttlMs: number) {}

  async resolve(
    esClient: ElasticsearchClient,
    index: string,
    fields: string[]
  ): Promise<SourceMetadata> {
    const [result] = await this.resolveMany(esClient, [{ index, fields }]);
    if (result.status === 'rejected') throw result.reason;
    return result.value;
  }

  async resolveMany(
    esClient: ElasticsearchClient,
    requests: MetadataRequest[]
  ): Promise<Array<PromiseSettledResult<SourceMetadata>>> {
    const patterns = [...new Set(requests.map(({ index }) => index))];
    const resolutions = await Promise.allSettled(
      patterns.map((index) =>
        this.cached(this.indexCache, index, () => this.loadIndices(esClient, index))
      )
    );
    const byPattern = new Map(patterns.map((pattern, index) => [pattern, resolutions[index]]));
    const indices = [
      ...new Set(
        resolutions.flatMap((result) => (result.status === 'fulfilled' ? result.value.indices : []))
      ),
    ].sort();
    const fields = [
      ...new Set(
        requests.flatMap((request) =>
          byPattern.get(request.index)?.status === 'fulfilled' ? request.fields : []
        )
      ),
    ].sort();

    let sharedFields: Map<string, Set<string>> | undefined;
    try {
      sharedFields = await this.resolveFields(esClient, indices, fields);
    } catch {
      // Retry per pattern to isolate a field-caps failure to its sources, as before batching.
    }
    const fallbackByPattern = new Map<string, Promise<Map<string, Set<string>>>>();
    return Promise.allSettled(
      requests.map(async (request): Promise<SourceMetadata> => {
        const resolution = byPattern.get(request.index);
        if (!resolution) throw new SourceNotFoundError(request.index);
        if (resolution.status === 'rejected') throw resolution.reason;
        const { indices: sourceIndices, engine } = resolution.value;
        let allFields = sharedFields;
        if (!allFields) {
          let fallback = fallbackByPattern.get(request.index);
          if (!fallback) {
            const sourceFields = [
              ...new Set(
                requests
                  .filter(({ index }) => index === request.index)
                  .flatMap((item) => item.fields)
              ),
            ].sort();
            fallback = this.resolveFields(esClient, sourceIndices, sourceFields);
            fallbackByPattern.set(request.index, fallback);
          }
          allFields = await fallback;
        }
        const mappedFieldsByIndex = new Map(
          sourceIndices.map((index) => [
            index,
            new Set(request.fields.filter((field) => allFields.get(index)?.has(field))),
          ])
        );
        return {
          indices: sourceIndices,
          engine,
          mappedFieldsByIndex,
          mappedFields: new Set([...mappedFieldsByIndex.values()].flatMap((mapped) => [...mapped])),
        };
      })
    );
  }

  clear(): void {
    this.indexCache.clear();
    this.fieldCache.clear();
  }

  private cached<T>(
    cache: Map<string, CacheEntry<T>>,
    key: string,
    load: () => Promise<T>
  ): Promise<T> {
    const now = Date.now();
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now) return cached.value;
    const value = load();
    cache.set(key, { expiresAt: now + this.ttlMs, value });
    value.catch(() => {
      if (cache.get(key)?.value === value) cache.delete(key);
    });
    return value;
  }

  private async loadIndices(esClient: ElasticsearchClient, index: string): Promise<SourceIndices> {
    const settings = (await esClient.indices.getSettings({
      index,
      name: 'index.mode',
      include_defaults: true,
      ignore_unavailable: true,
      allow_no_indices: true,
      expand_wildcards: ['open', 'hidden'],
    })) as SettingsResponse;
    const indices = Object.keys(settings).sort();
    if (indices.length === 0) throw new SourceNotFoundError(index);
    const engine = indices.every((name) => indexMode(settings[name]) === 'time_series')
      ? 'TS'
      : 'FROM';
    return { indices, engine };
  }

  private resolveFields(
    esClient: ElasticsearchClient,
    indices: string[],
    fields: string[]
  ): Promise<Map<string, Set<string>>> {
    const key = JSON.stringify([indices, fields]);
    return this.cached(this.fieldCache, key, async () => {
      const mappedFieldsByIndex = new Map(indices.map((index) => [index, new Set<string>()]));
      if (indices.length === 0 || fields.length === 0) return mappedFieldsByIndex;
      const caps = await esClient.fieldCaps({
        index: indices,
        fields,
        include_unmapped: true,
        ignore_unavailable: true,
        allow_no_indices: true,
        expand_wildcards: ['open', 'hidden'],
        filters: '-metadata',
      });
      for (const [field, types] of Object.entries(caps.fields)) {
        if (!fields.includes(field)) continue;
        const unmappedIndices = new Set(types.unmapped?.indices ?? []);
        for (const [type, capabilities] of Object.entries(types)) {
          if (type === 'unmapped') continue;
          for (const name of capabilities.indices ?? indices) {
            if (!unmappedIndices.has(name)) mappedFieldsByIndex.get(name)?.add(field);
          }
        }
      }
      return mappedFieldsByIndex;
    });
  }
}
