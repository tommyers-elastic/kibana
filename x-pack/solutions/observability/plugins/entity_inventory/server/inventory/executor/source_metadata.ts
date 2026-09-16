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
}

interface CacheEntry {
  expiresAt: number;
  value: Promise<SourceMetadata>;
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

/**
 * Resolves, per source pattern, what the generator cannot know from the definition: which engine
 * the pattern supports and which declared fields exist. Two cheap calls (`_settings/index.mode`
 * and `_field_caps`), cached per pattern and field set for a short TTL. The cache is shared across
 * users; it holds index names and field names only.
 */
export class SourceMetadataResolver {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly ttlMs: number) {}

  resolve(esClient: ElasticsearchClient, index: string, fields: string[]): Promise<SourceMetadata> {
    const key = `${index}|${[...fields].sort().join(',')}`;
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }
    const value = this.load(esClient, index, fields);
    this.cache.set(key, { expiresAt: now + this.ttlMs, value });
    value.catch(() => this.cache.delete(key));
    return value;
  }

  clear(): void {
    this.cache.clear();
  }

  private async load(
    esClient: ElasticsearchClient,
    index: string,
    fields: string[]
  ): Promise<SourceMetadata> {
    const settings = (await esClient.indices.getSettings({
      index,
      name: 'index.mode',
      include_defaults: true,
      ignore_unavailable: true,
      allow_no_indices: true,
      expand_wildcards: ['open', 'hidden'],
    })) as SettingsResponse;
    const indices = Object.keys(settings).sort();
    if (indices.length === 0) {
      throw new SourceNotFoundError(index);
    }
    const engine: InventoryEngine = indices.every(
      (name) => indexMode(settings[name]) === 'time_series'
    )
      ? 'TS'
      : 'FROM';

    const mappedFields = new Set<string>();
    if (fields.length > 0) {
      const caps = await esClient.fieldCaps({
        index,
        fields,
        ignore_unavailable: true,
        allow_no_indices: true,
        expand_wildcards: ['open', 'hidden'],
        filters: '-metadata',
      });
      for (const [field, types] of Object.entries(caps.fields)) {
        if (fields.includes(field) && Object.keys(types).some((type) => type !== 'unmapped')) {
          mappedFields.add(field);
        }
      }
    }
    return { indices, engine, mappedFields };
  }
}
