/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { isBoom } from '@hapi/boom';
import type { z } from '@kbn/zod/v4';
import type {
  EntityDefinition,
  EntityDefinitionInventorySource,
  EntityDefinitionRecord,
  EntityDefinitionSource,
} from '@kbn/entity-store/common';
import { getInventoryIdentityPlan } from '@kbn/entity-store/common';
import {
  DynamicDefinitionsDisabledError,
  EntityDefinitionAlreadyExistsError,
  EntityDefinitionIdentityChangedError,
  EntityDefinitionNotFoundError,
  EntityDefinitionValidationError,
  InventoryExtensionAlreadyExistsError,
  InventoryExtensionCodeRegisteredError,
} from '@kbn/entity-store/server';
import {
  formatIdentityCompositions,
  type InventoryIdentityDescriptor,
  type InventoryListResponse,
} from '../../../common';

/** What the tool user may do with a record through the definitions API. */
export type DocumentKind = 'definition' | 'extension' | 'read_only';

export type ReadOnlyReason = 'code' | 'built_in_without_extension' | 'built_in_code_extension';

export interface EntityTypeSummary {
  type: string;
  label: string;
  source: EntityDefinitionSource;
  inventorySource?: EntityDefinitionInventorySource;
  /** `definition`: replace with a `type` document; `extension`: replace with an `extends` document. */
  editable: DocumentKind;
  identity: InventoryIdentityDescriptor;
  attributes: string[];
  metrics: string[];
  sources: Array<{
    index: string;
    filter?: string;
    metrics: string[];
    /** Metric name to its own ES|QL `filter`, for the metrics of this source that declare one. */
    metricFilters?: Record<string, string>;
    attributes: string[];
  }>;
}

export interface DefinitionDocumentResult {
  type: string;
  kind: DocumentKind;
  readOnlyReason?: ReadOnlyReason;
  source: EntityDefinitionSource;
  inventorySource?: EntityDefinitionInventorySource;
  createdAt?: string;
  updatedAt?: string;
  /** The body `save_definition` accepts for this record (or the read-only definition). */
  document: Record<string, unknown>;
}

/** Read from `identityField`: one composition is a tuple, several are ranked alternatives. */
export const describeIdentity = (definition: EntityDefinition): InventoryIdentityDescriptor => {
  const { compositions, fields } = getInventoryIdentityPlan(definition);
  return { kind: compositions.length === 1 ? 'tuple' : 'ranking', fields, compositions };
};

const editability = (
  record: EntityDefinitionRecord
): { kind: DocumentKind; readOnlyReason?: ReadOnlyReason } => {
  const { source, inventorySource } = record;
  if (source === 'api') {
    return { kind: 'definition' };
  }
  if (source === 'built_in' && inventorySource === 'api') {
    return { kind: 'extension' };
  }
  if (source === 'built_in') {
    return {
      kind: 'read_only',
      readOnlyReason:
        inventorySource === 'code' ? 'built_in_code_extension' : 'built_in_without_extension',
    };
  }
  return { kind: 'read_only', readOnlyReason: 'code' };
};

/** Compact, LLM-readable description of one inventory type. */
export const summarizeEntityType = (record: EntityDefinitionRecord): EntityTypeSummary => {
  const { definition, source, inventorySource } = record;
  const inventory = definition.inventory;
  const sources = (inventory?.sources ?? []).map(({ index, filter, metrics, attributes }) => {
    const metricFilters = Object.fromEntries(
      (metrics ?? []).flatMap((metric) =>
        metric.filter !== undefined ? [[metric.name, metric.filter]] : []
      )
    );
    return {
      index,
      ...(filter !== undefined ? { filter } : {}),
      metrics: (metrics ?? []).map(({ name }) => name),
      ...(Object.keys(metricFilters).length > 0 ? { metricFilters } : {}),
      attributes: (attributes ?? []).map(({ name }) => name),
    };
  });
  return {
    type: definition.type,
    label: inventory?.label ?? definition.type,
    source,
    ...(inventorySource !== undefined ? { inventorySource } : {}),
    editable: editability(record).kind,
    identity: describeIdentity(definition),
    attributes: [...(inventory?.attributes ?? [])],
    metrics: [...new Set(sources.flatMap(({ metrics }) => metrics))],
    sources,
  };
};

/** The record as the definitions API would accept it back: a definition without `id`, or an `extends` document. */
export const toDefinitionDocument = (record: EntityDefinitionRecord): DefinitionDocumentResult => {
  const { definition, source, inventorySource, createdAt, updatedAt } = record;
  const { kind, readOnlyReason } = editability(record);
  const document: Record<string, unknown> =
    kind === 'definition'
      ? (({ id, ...withoutId }) => withoutId)(definition)
      : kind === 'extension'
      ? { extends: definition.type, inventory: definition.inventory }
      : (definition as unknown as Record<string, unknown>);
  return {
    type: definition.type,
    kind,
    ...(readOnlyReason !== undefined ? { readOnlyReason } : {}),
    source,
    ...(inventorySource !== undefined ? { inventorySource } : {}),
    ...(createdAt !== undefined ? { createdAt } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
    document,
  };
};

/** The type a document registers under: `type` for a definition, `extends` for an extension. */
export const getDocumentType = (document: Record<string, unknown>): string | undefined => {
  const candidate = 'extends' in document ? document.extends : document.type;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
};

export interface FormattedIssue {
  path: string;
  message: string;
}

export const formatIssues = (issues: z.core.$ZodIssue[]): FormattedIssue[] =>
  issues.map(({ path, message }) => ({
    path: path.length > 0 ? path.map(String).join('.') : '<root>',
    message,
  }));

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** Field compositions of an unvalidated `identityField` block; empty when the shape is not recognised. */
const identityCompositionsOf = (identityField: unknown): string[][] => {
  const block = asRecord(identityField);
  if (!block) {
    return [];
  }
  if (typeof block.singleField === 'string') {
    return [[block.singleField]];
  }
  const branches = asRecord(block.euidRanking)?.branches;
  if (!Array.isArray(branches)) {
    return [];
  }
  return branches.flatMap((branch) => {
    const ranking = asRecord(branch)?.ranking;
    return Array.isArray(ranking)
      ? ranking.map((composition) =>
          (Array.isArray(composition) ? composition : [])
            .map(asRecord)
            .flatMap((part) => (typeof part?.field === 'string' ? [part.field] : []))
        )
      : [];
  });
};

/**
 * Markdown summary of a candidate document for the confirmation dialog: kind, type, identity
 * (from `identityField`), attributes and every source with its index, filter and metric names. Tolerates any shape, since
 * the document has not been validated when the user is asked.
 */
export const summarizeDocument = (document: Record<string, unknown>): string => {
  const isExtension = 'extends' in document;
  const type = getDocumentType(document) ?? '(missing type)';
  const inventory = asRecord(document.inventory);
  const lines: string[] = [
    isExtension
      ? `**Extension** of the built-in type \`${type}\``
      : `**Definition** of the type \`${type}\``,
  ];
  if (typeof inventory?.label === 'string') {
    lines.push(`Label: ${inventory.label}`);
  }
  const compositions = identityCompositionsOf(document.identityField);
  if (compositions.length > 0) {
    lines.push(
      `Identity: ${formatIdentityCompositions(
        compositions.map((composition) => composition.map((field) => `\`${field}\``))
      )}`
    );
  }
  const attributes = asStrings(inventory?.attributes);
  if (attributes.length > 0) {
    lines.push(`Attributes: ${attributes.map((field) => `\`${field}\``).join(', ')}`);
  }
  const sources = Array.isArray(inventory?.sources) ? inventory.sources : [];
  lines.push(`Sources (${sources.length}):`);
  for (const candidate of sources) {
    const source = asRecord(candidate);
    if (!source) {
      lines.push('- (invalid source)');
      continue;
    }
    const index = typeof source.index === 'string' ? source.index : '(missing index)';
    const filter = typeof source.filter === 'string' ? ` where \`${source.filter}\`` : '';
    const metrics = (Array.isArray(source.metrics) ? source.metrics : [])
      .map(asRecord)
      .flatMap((metric) => {
        if (!metric || typeof metric.name !== 'string') {
          return [];
        }
        // `name (agg of field where filter)`: the filter is the one line of ES|QL on a metric and
        // the thing the user most needs to see before confirming.
        const detail = [
          typeof metric.agg === 'string' ? metric.agg : '',
          typeof metric.field === 'string' ? `of ${metric.field}` : '',
          typeof metric.filter === 'string' ? `where \`${metric.filter}\`` : '',
        ]
          .filter((part) => part !== '')
          .join(' ');
        return [detail === '' ? metric.name : `${metric.name} (${detail})`];
      });
    const sourceAttributes = (Array.isArray(source.attributes) ? source.attributes : [])
      .map(asRecord)
      .flatMap((attribute) =>
        attribute && typeof attribute.name === 'string' ? [attribute.name] : []
      );
    lines.push(
      `- \`${index}\`${filter}${
        metrics.length > 0 ? `; metrics: ${metrics.join(', ')}` : '; no metrics'
      }${sourceAttributes.length > 0 ? `; attributes: ${sourceAttributes.join(', ')}` : ''}`
    );
  }
  return lines.join('\n');
};

export type DefinitionErrorKind =
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'disabled'
  | 'forbidden'
  | 'unexpected';

export interface DescribedError {
  kind: DefinitionErrorKind;
  message: string;
  /** What the agent should do next. */
  hint?: string;
}

/** Maps store and inventory errors to a result the agent can act on. */
export const describeDefinitionError = (error: unknown): DescribedError => {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof DynamicDefinitionsDisabledError) {
    return {
      kind: 'disabled',
      message,
      hint: 'Ask an administrator to enable the "entityStore:dynamicDefinitionsEnabled" ui setting; definitions cannot be written until then.',
    };
  }
  if (error instanceof EntityDefinitionValidationError) {
    return {
      kind: 'validation',
      message,
      hint: 'Fix the document according to the message and try again.',
    };
  }
  if (error instanceof EntityDefinitionNotFoundError) {
    return {
      kind: 'not_found',
      message,
      hint: 'There is nothing to replace: call the tool with replace: false to create it, or check the type with list_types.',
    };
  }
  if (error instanceof EntityDefinitionAlreadyExistsError) {
    return {
      kind: 'conflict',
      message,
      hint: 'The type already exists: call the tool with replace: true to update it (get_definition shows the current document).',
    };
  }
  if (error instanceof EntityDefinitionIdentityChangedError) {
    return {
      kind: 'conflict',
      message,
      hint: 'The identity changed, which renames every entity id of the type. Explain this to the user and call the tool again with force: true only if they accept.',
    };
  }
  if (error instanceof InventoryExtensionAlreadyExistsError) {
    return {
      kind: 'conflict',
      message,
      hint: 'The built-in type already has an API extension: call the tool with replace: true to update it.',
    };
  }
  if (error instanceof InventoryExtensionCodeRegisteredError) {
    return {
      kind: 'conflict',
      message,
      hint: 'A code-registered extension cannot be replaced or deleted through the API; tell the user.',
    };
  }
  if (isBoom(error)) {
    return {
      kind: error.output.statusCode === 403 ? 'forbidden' : 'unexpected',
      message: error.output.payload.message ?? message,
    };
  }
  return { kind: 'unexpected', message };
};

/** The list response without the parts the agent cannot use (parameters, wall-clock timings). */
export const shapePreview = (
  response: InventoryListResponse,
  window: { from: string; to: string }
) => ({
  type: response.type,
  window,
  total: response.total,
  truncated: response.truncated,
  returnedRows: response.rows.length,
  columns: response.columns.map(({ name, kind, unit, esType, fields }) => ({
    name,
    kind,
    ...(unit !== undefined ? { unit } : {}),
    ...(esType !== undefined ? { esType } : {}),
    ...(fields !== undefined ? { fields } : {}),
  })),
  rows: response.rows,
  provenance: response.provenance,
  queries: response.queries.map(
    ({ index, engine, tookMs, documentsFound, rows, capped, esql }) => ({
      index,
      engine,
      ...(tookMs !== undefined ? { tookMs } : {}),
      ...(documentsFound !== undefined ? { documentsFound } : {}),
      ...(rows !== undefined ? { rows } : {}),
      ...(capped ? { capped } : {}),
      esql,
    })
  ),
  errors: response.errors,
  unavailableColumns: response.unavailableColumns,
  esTookMs: response.esTookMs,
});

export type PreviewResult = ReturnType<typeof shapePreview>;
