/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core/server';
import type { ESQLSearchResponse } from '@kbn/es-types';
import type { QueryDslQueryContainer, FieldValue } from '@elastic/elasticsearch/lib/api/types';
import type { InventoryRow, InventorySourceError } from '../../../common';
import type { GeneratedQuery } from '../generator';

export interface EsqlResult {
  response: ESQLSearchResponse;
  /** Wall time of the round trip from Kibana. */
  wallMs: number;
}

/**
 * Runs one generated query. Named parameters travel as request parameters, never interpolated; an
 * optional query DSL `documentFilter` is applied by Elasticsearch before the pipeline.
 * The client's response type lacks `documents_found`; `ESQLSearchResponse`
 * from `@kbn/es-types` has it.
 */
export const executeEsql = async (
  esClient: ElasticsearchClient,
  { esql, params }: GeneratedQuery,
  documentFilter?: QueryDslQueryContainer,
  signal?: AbortSignal
): Promise<EsqlResult> => {
  const started = performance.now();
  const response = (await esClient.esql.query(
    {
      query: esql,
      // The client types named parameters as positional values; the wire format is the same.
      params: params as unknown as FieldValue[],
      ...(documentFilter ? { filter: documentFilter } : {}),
    },
    { signal }
  )) as unknown as ESQLSearchResponse;
  return { response, wallMs: Math.round(performance.now() - started) };
};

/** `columns` + `values` to one object per row, keyed by column name. */
export const rowsToObjects = (response: ESQLSearchResponse): InventoryRow[] => {
  const names = response.columns.map(({ name }) => name);
  return response.values.map((values) => {
    const row: InventoryRow = {};
    names.forEach((name, index) => {
      row[name] = values[index];
    });
    return row;
  });
};

interface ErrorLike {
  message?: string;
  statusCode?: number;
  meta?: { statusCode?: number; body?: { error?: { reason?: string; type?: string } } };
}

/** Flattens an ES client error to what the response reports; never leaks stack traces. */
export const toSourceError = (index: string, error: unknown): InventorySourceError => {
  const e = (error ?? {}) as ErrorLike;
  const reason = e.meta?.body?.error?.reason;
  const type = e.meta?.body?.error?.type;
  const message = reason ? `${type ? `${type}: ` : ''}${reason}` : e.message ?? 'unknown error';
  const statusCode = e.meta?.statusCode ?? e.statusCode;
  return { index, message, ...(statusCode !== undefined ? { statusCode } : {}) };
};
