/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { InventorySource } from '@kbn/entity-store/common';
import type { InventoryEngine, InventorySort } from '../../../common';

/** Named ES|QL parameters in the request-body shape (`[{ name: value }, ...]`). */
export type NamedParams = Array<Record<string, string | number | boolean>>;

export interface GeneratedQuery {
  esql: string;
  params: NamedParams;
}

/** A source with the engine the executor resolved for its index pattern. */
export interface SourcePlan {
  source: InventorySource;
  engine: InventoryEngine;
}

export interface TimeRange {
  /** ISO 8601, inclusive. */
  from: string;
  /** ISO 8601, exclusive. */
  to: string;
}

export interface SourceQueryOptions {
  range: TimeRange;
  /**
   * Rows to request from this source. With `pushDownSort` the caller's sort and limit are applied
   * in ES|QL (single-source lists); otherwise the query sorts by `last_seen` and returns up to the
   * ES|QL row cap so the newest entities survive when a source is capped.
   */
  limit: number;
  sort?: InventorySort;
  pushDownSort: boolean;
  /** Detail queries: equality on these identity fields (values become named parameters). */
  identityValues?: Record<string, string>;
}
