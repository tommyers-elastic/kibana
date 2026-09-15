/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StoredEntityDefinitionAttributes } from './saved_object';

/** How long a space's dynamic definitions are served from memory before being reloaded. */
export const DEFINITIONS_CACHE_TTL_MS = 30_000;

interface CacheEntry {
  loadedAt: number;
  byType: ReadonlyMap<string, StoredEntityDefinitionAttributes>;
}

/**
 * Process-local, per-space cache of dynamic definitions shared by every registry and client
 * instance in this Kibana node. Writes through the definitions client invalidate the space
 * immediately; writes on other nodes become visible after {@link DEFINITIONS_CACHE_TTL_MS}.
 */
export class EntityDefinitionsCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly ttlMs: number = DEFINITIONS_CACHE_TTL_MS,
    private readonly now: () => number = Date.now
  ) {}

  get(namespace: string): ReadonlyMap<string, StoredEntityDefinitionAttributes> | undefined {
    const entry = this.entries.get(namespace);
    if (!entry) {
      return undefined;
    }
    if (this.now() - entry.loadedAt > this.ttlMs) {
      this.entries.delete(namespace);
      return undefined;
    }
    return entry.byType;
  }

  set(namespace: string, definitions: readonly StoredEntityDefinitionAttributes[]): void {
    this.entries.set(namespace, {
      loadedAt: this.now(),
      byType: new Map(definitions.map((stored) => [stored.type, stored])),
    });
  }

  invalidate(namespace: string): void {
    this.entries.delete(namespace);
  }
}
