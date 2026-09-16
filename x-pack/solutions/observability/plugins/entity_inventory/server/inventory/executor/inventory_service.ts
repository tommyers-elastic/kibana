/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core/server';
import type { Logger } from '@kbn/logging';
import type { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';
import type {
  EntityDefinition,
  EntityDefinitionRecord,
  InventorySource,
} from '@kbn/entity-store/common';
import type { EntityDefinitionRegistry } from '@kbn/entity-store/server';
import {
  DEFAULT_LIST_LIMIT,
  ENTITY_ID_COLUMN,
  ESQL_MAX_ROWS,
  LAST_SEEN_COLUMN,
  type InventoryColumn,
  type InventoryCountResponse,
  type InventoryDocumentCountsResponse,
  type InventoryListResponse,
  type InventoryProvenance,
  type InventoryQueryInfo,
  type InventoryRow,
  type InventorySort,
  type InventorySourceError,
  type InventoryTypeDescriptor,
  type InventoryTypesResponse,
  type InventoryUnavailableColumn,
} from '../../../common';
import {
  COUNT_COLUMN,
  assertSafeIndexPattern,
  buildColumns,
  buildCountQuery,
  buildSourceQuery,
  getInventory,
  resolveIdentityPlan,
  type GeneratedQuery,
  type IdentityPlan,
  type SourcePlan,
  type TimeRange,
} from '../generator';
import { executeEsql, rowsToObjects, toSourceError } from './esql_client';
import { applyValueLabels, mergeRows, sortRows } from './merge';
import { InventoryRequestError, InventoryTypeNotFoundError, SourceNotFoundError } from './errors';
import type { SourceMetadataResolver } from './source_metadata';

export interface ListRequest extends TimeRange {
  limit?: number;
  sort?: InventorySort;
  /** Caller's pre-aggregation filter as query DSL; applied to every source and to the count. */
  filter?: QueryDslQueryContainer;
}

export interface DetailRequest extends TimeRange {
  identity: Record<string, string>;
}

export type CountRequest = Pick<ListRequest, 'from' | 'to' | 'filter'>;

interface InventoryServiceDeps {
  esClient: ElasticsearchClient;
  registry: EntityDefinitionRegistry;
  metadata: SourceMetadataResolver;
  logger: Logger;
  signal?: AbortSignal;
}

interface ResolvedSource extends SourcePlan {
  unavailable: InventoryUnavailableColumn[];
}

interface Resolution {
  definition: EntityDefinition;
  identity: IdentityPlan;
  columns: InventoryColumn[];
  sources: ResolvedSource[];
  errors: InventorySourceError[];
  unavailableColumns: InventoryUnavailableColumn[];
}

const DEFAULT_SORT: InventorySort = { column: LAST_SEEN_COLUMN, direction: 'desc' };
const DETAIL_LIMIT = 50;

/** Fields a source needs mapped: identity, top-level attributes, its own attributes and metrics. */
const declaredFields = (
  definition: EntityDefinition,
  identity: IdentityPlan,
  source: InventorySource
) => [
  ...identity.fields,
  ...(getInventory(definition).attributes ?? []),
  ...(source.attributes ?? []).map(({ field }) => field),
  ...(source.metrics ?? []).map(({ field }) => field),
];

/**
 * Lists, details and counts entities of one type by generating ES|QL from its definition and
 * running one query per source concurrently, then merging by entity id in Kibana. See the plugin
 * README for the query shapes and merge semantics.
 */
export class InventoryService {
  constructor(private readonly deps: InventoryServiceDeps) {}

  async listTypes(): Promise<InventoryTypesResponse> {
    const records = await this.deps.registry.getDefinitions({ inventory: true });
    const types = records.flatMap((record): InventoryTypeDescriptor[] => {
      try {
        return [this.describe(record)];
      } catch (error) {
        this.deps.logger.warn(
          `Skipping entity type "${record.definition.type}" in the inventory types list: ${
            (error as Error).message
          }`
        );
        return [];
      }
    });
    return { types };
  }

  async list(type: string, request: ListRequest): Promise<InventoryListResponse> {
    const started = performance.now();
    const limit = Math.min(request.limit ?? DEFAULT_LIST_LIMIT, ESQL_MAX_ROWS);
    const sort = request.sort ?? DEFAULT_SORT;
    const resolution = await this.resolve(type);
    this.assertSortable(resolution.columns, sort);
    const range = { from: request.from, to: request.to };
    const pushDownSort = resolution.sources.length === 1;

    const queries = resolution.sources.map((plan) => ({
      plan,
      query: buildSourceQuery(resolution.definition, resolution.identity, plan, {
        range,
        limit,
        sort,
        pushDownSort,
      }),
    }));
    const countQuery =
      resolution.sources.length > 0
        ? buildCountQuery(
            resolution.definition,
            resolution.identity,
            resolution.sources.map(({ source }) => source),
            range
          )
        : undefined;

    const [sourceResults, countResult] = await Promise.all([
      this.runSourceQueries(queries, request.filter),
      countQuery ? this.runCount(countQuery, request.filter) : Promise.resolve(undefined),
    ]);

    const inputs = sourceResults.flatMap(({ plan, rows }) =>
      rows ? [{ index: plan.source.index, rows: applyValueLabels(rows, plan.source) }] : []
    );
    const merged = mergeRows(inputs, resolution.columns);
    let rows = merged.rows;
    if (!pushDownSort) {
      rows = sortRows(rows, sort);
    }
    const returned = rows.slice(0, limit).map((row) => withEveryColumn(row, resolution.columns));
    const provenance = provenanceFor(returned, merged.provenance);

    const total = countResult?.count ?? null;
    const anyCapped = sourceResults.some(({ info }) => info.capped);
    const truncated =
      total !== null ? total > returned.length : anyCapped || rows.length > returned.length;

    const queriesInfo = [
      ...sourceResults.map(({ info }) => info),
      ...(countResult ? [countResult.info] : []),
    ];
    return {
      type,
      columns: this.withTypes(resolution.columns, sourceResults),
      rows: returned,
      provenance,
      total,
      truncated,
      tookMs: Math.round(performance.now() - started),
      esTookMs: sumTook(queriesInfo),
      queries: queriesInfo,
      unavailableColumns: resolution.unavailableColumns,
      errors: [
        ...resolution.errors,
        ...sourceResults.flatMap(({ error }) => (error ? [error] : [])),
        ...(countResult?.error ? [countResult.error] : []),
      ],
    };
  }

  async detail(type: string, request: DetailRequest): Promise<InventoryListResponse> {
    const started = performance.now();
    const resolution = await this.resolve(type);
    const unknown = Object.keys(request.identity).filter(
      (field) => !resolution.identity.fields.includes(field)
    );
    if (unknown.length > 0) {
      throw new InventoryRequestError(
        `Not identity fields of "${type}": ${unknown.join(
          ', '
        )} (expected ${resolution.identity.fields.join(', ')})`
      );
    }
    const range = { from: request.from, to: request.to };
    const queries = resolution.sources.map((plan) => ({
      plan,
      query: buildSourceQuery(resolution.definition, resolution.identity, plan, {
        range,
        limit: DETAIL_LIMIT,
        pushDownSort: false,
        identityValues: request.identity,
      }),
    }));
    const sourceResults = await this.runSourceQueries(queries);
    const merged = mergeRows(
      sourceResults.flatMap(({ plan, rows: r }) =>
        r ? [{ index: plan.source.index, rows: applyValueLabels(r, plan.source) }] : []
      ),
      resolution.columns
    );
    const rows = sortRows(merged.rows, DEFAULT_SORT)
      .slice(0, DETAIL_LIMIT)
      .map((row) => withEveryColumn(row, resolution.columns));
    const provenance = provenanceFor(rows, merged.provenance);
    const queriesInfo = sourceResults.map(({ info }) => info);
    return {
      type,
      columns: this.withTypes(resolution.columns, sourceResults),
      rows,
      provenance,
      total: rows.length,
      truncated: false,
      tookMs: Math.round(performance.now() - started),
      esTookMs: sumTook(queriesInfo),
      queries: queriesInfo,
      unavailableColumns: resolution.unavailableColumns,
      errors: [
        ...resolution.errors,
        ...sourceResults.flatMap(({ error }) => (error ? [error] : [])),
      ],
    };
  }

  async count(type: string, request: CountRequest): Promise<InventoryCountResponse> {
    const started = performance.now();
    const resolution = await this.resolve(type);
    if (resolution.sources.length === 0) {
      return {
        type,
        count: null,
        tookMs: Math.round(performance.now() - started),
        esTookMs: 0,
        queries: [],
        errors: resolution.errors,
      };
    }
    const query = buildCountQuery(
      resolution.definition,
      resolution.identity,
      resolution.sources.map(({ source }) => source),
      { from: request.from, to: request.to }
    );
    const result = await this.runCount(query, request.filter);
    return {
      type,
      count: result.count,
      tookMs: Math.round(performance.now() - started),
      esTookMs: sumTook([result.info]),
      queries: [result.info],
      errors: [...resolution.errors, ...(result.error ? [result.error] : [])],
    };
  }

  /**
   * Documents in the window per distinct source pattern, with no predicates: what a source's
   * `documentsFound` is measured against. One `FROM ... | STATS COUNT(*)` per pattern, run
   * concurrently; failures are reported per pattern.
   */
  async documentCounts(type: string, range: TimeRange): Promise<InventoryDocumentCountsResponse> {
    const record = await this.deps.registry.getDefinition(type);
    if (!record || !record.definition.inventory) {
      throw new InventoryTypeNotFoundError(type);
    }
    const patterns = [
      ...new Set(getInventory(record.definition).sources.map(({ index }) => index)),
    ];
    const counts = await Promise.all(
      patterns.map(async (index) => {
        try {
          assertSafeIndexPattern(index);
          const query: GeneratedQuery = {
            esql: `FROM ${index}\n| WHERE @timestamp >= ?from AND @timestamp < ?to\n| STATS \`count\` = COUNT(*)`,
            params: [{ from: range.from }, { to: range.to }],
          };
          const { response } = await executeEsql(
            this.deps.esClient,
            query,
            undefined,
            this.deps.signal
          );
          const value = response.values[0]?.[0];
          return {
            index,
            documentsInWindow: typeof value === 'number' ? value : 0,
            tookMs: response.took,
          };
        } catch (error) {
          return { index, documentsInWindow: null, error: toSourceError(index, error).message };
        }
      })
    );
    return { type, from: range.from, to: range.to, counts };
  }

  private describe(record: EntityDefinitionRecord): InventoryTypeDescriptor {
    const { definition } = record;
    const inventory = getInventory(definition);
    const identity = resolveIdentityPlan(definition);
    return {
      type: definition.type,
      label: inventory.label ?? definition.type,
      identity: { kind: identity.kind, fields: identity.fields },
      columns: buildColumns(definition, identity),
      sources: inventory.sources.map(({ index, filter }) => ({
        index,
        ...(filter !== undefined ? { filter } : {}),
      })),
      definitionSource: record.source,
      ...(record.inventorySource ? { inventorySource: record.inventorySource } : {}),
    };
  }

  /** Loads the definition and resolves every source's engine and mapped fields, isolating failures. */
  private async resolve(type: string): Promise<Resolution> {
    const record = await this.deps.registry.getDefinition(type);
    if (!record || !record.definition.inventory) {
      throw new InventoryTypeNotFoundError(type);
    }
    const { definition } = record;
    const identity = resolveIdentityPlan(definition);
    const columns = buildColumns(definition, identity);
    const inventory = getInventory(definition);

    const settled = await Promise.allSettled(
      inventory.sources.map(async (source): Promise<ResolvedSource> => {
        const fields = [...new Set(declaredFields(definition, identity, source))];
        const metadata = await this.deps.metadata.resolve(this.deps.esClient, source.index, fields);
        const identityMapped = identity.fields.some((field) => metadata.mappedFields.has(field));
        if (!identityMapped) {
          throw new Error(
            `none of the identity fields (${identity.fields.join(', ')}) is mapped in "${
              source.index
            }"`
          );
        }
        const unavailable: InventoryUnavailableColumn[] = [];
        for (const field of inventory.attributes ?? []) {
          if (!metadata.mappedFields.has(field)) {
            unavailable.push({ index: source.index, column: field, field });
          }
        }
        for (const { name, field } of source.attributes ?? []) {
          if (!metadata.mappedFields.has(field)) {
            unavailable.push({ index: source.index, column: name, field });
          }
        }
        for (const { name, field } of source.metrics ?? []) {
          if (!metadata.mappedFields.has(field)) {
            unavailable.push({ index: source.index, column: name, field });
          }
        }
        return { source, engine: metadata.engine, unavailable };
      })
    );

    const sources: ResolvedSource[] = [];
    const errors: InventorySourceError[] = [];
    settled.forEach((result, index) => {
      const { index: pattern } = inventory.sources[index];
      if (result.status === 'fulfilled') {
        sources.push(result.value);
        return;
      }
      const reason = result.reason;
      errors.push(
        reason instanceof SourceNotFoundError || reason instanceof Error
          ? { index: pattern, message: reason.message }
          : toSourceError(pattern, reason)
      );
    });
    return {
      definition,
      identity,
      columns,
      sources,
      errors,
      unavailableColumns: dedupeUnavailable(sources.flatMap(({ unavailable }) => unavailable)),
    };
  }

  private assertSortable(columns: InventoryColumn[], sort: InventorySort): void {
    if (!columns.some(({ name }) => name === sort.column)) {
      throw new InventoryRequestError(
        `Cannot sort by "${sort.column}": not an output column (${columns
          .map(({ name }) => name)
          .join(', ')})`
      );
    }
  }

  private async runSourceQueries(
    queries: Array<{ plan: SourcePlan; query: GeneratedQuery }>,
    filter?: QueryDslQueryContainer
  ): Promise<
    Array<{
      plan: SourcePlan;
      rows?: InventoryRow[];
      columnTypes?: Record<string, string>;
      info: InventoryQueryInfo;
      error?: InventorySourceError;
    }>
  > {
    return Promise.all(
      queries.map(async ({ plan, query }) => {
        const info: InventoryQueryInfo = {
          index: plan.source.index,
          engine: plan.engine,
          esql: query.esql,
          params: Object.assign({}, ...query.params),
        };
        try {
          const { response } = await executeEsql(
            this.deps.esClient,
            query,
            filter,
            this.deps.signal
          );
          const rows = rowsToObjects(response);
          info.tookMs = response.took;
          info.documentsFound = response.documents_found;
          info.rows = rows.length;
          info.capped = rows.length >= ESQL_MAX_ROWS;
          const columnTypes = Object.fromEntries(
            response.columns.map(({ name, type }) => [name, type])
          );
          return { plan, rows, columnTypes, info };
        } catch (error) {
          const sourceError = toSourceError(plan.source.index, error);
          this.deps.logger.debug(
            `Inventory source query failed for "${plan.source.index}": ${sourceError.message}`
          );
          return { plan, info, error: sourceError };
        }
      })
    );
  }

  private async runCount(
    query: GeneratedQuery,
    filter?: QueryDslQueryContainer
  ): Promise<{ count: number | null; info: InventoryQueryInfo; error?: InventorySourceError }> {
    const info: InventoryQueryInfo = {
      index: '*',
      engine: 'COUNT',
      esql: query.esql,
      params: Object.assign({}, ...query.params),
    };
    try {
      const { response } = await executeEsql(this.deps.esClient, query, filter, this.deps.signal);
      info.tookMs = response.took;
      info.documentsFound = response.documents_found;
      const countIndex = response.columns.findIndex(({ name }) => name === COUNT_COLUMN);
      const value = response.values[0]?.[countIndex];
      return { count: typeof value === 'number' ? value : 0, info };
    } catch (error) {
      return { count: null, info, error: toSourceError('*', error) };
    }
  }

  private withTypes(
    columns: InventoryColumn[],
    results: Array<{ columnTypes?: Record<string, string> }>
  ): InventoryColumn[] {
    return columns.map((column) => {
      for (const { columnTypes } of results) {
        const esType = columnTypes?.[column.name];
        if (esType && esType !== 'null') {
          return { ...column, esType };
        }
      }
      return column;
    });
  }
}

/** The same index pattern may back several sources; report each unmapped column once per pattern. */
const dedupeUnavailable = (items: InventoryUnavailableColumn[]): InventoryUnavailableColumn[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.index}|${item.column}|${item.field}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

/** Provenance restricted to the returned rows. */
const provenanceFor = (rows: InventoryRow[], all: InventoryProvenance): InventoryProvenance =>
  Object.fromEntries(
    rows.flatMap((row) => {
      const id = row[ENTITY_ID_COLUMN];
      return typeof id === 'string' && all[id] ? [[id, all[id]]] : [];
    })
  );

/** Every row carries every output column, null when no source produced it. */
const withEveryColumn = (row: InventoryRow, columns: InventoryColumn[]): InventoryRow => {
  const filled: InventoryRow = {};
  for (const { name } of columns) {
    filled[name] = row[name] ?? null;
  }
  return filled;
};

const sumTook = (queries: InventoryQueryInfo[]): number =>
  queries.reduce((sum, { tookMs }) => sum + (tookMs ?? 0), 0);
