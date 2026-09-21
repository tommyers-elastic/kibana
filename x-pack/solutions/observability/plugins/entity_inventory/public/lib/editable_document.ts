/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { EntityDefinitionRecord } from '@kbn/entity-store/common';

/** A body the definitions API accepts: a full definition (`type`) or a built-in extension (`extends`). */
export type DefinitionDocument = Record<string, unknown>;

export type ReadOnlyReason = 'code' | 'built_in_without_extension' | 'built_in_code_extension';

/**
 * What the editor may do with a record: replace an API definition, replace an API extension of a
 * built-in, or only display it. `document` is what the editor shows and, when editable, what a
 * save sends back.
 */
export type Editability =
  | { kind: 'definition'; document: DefinitionDocument }
  | { kind: 'extension'; document: DefinitionDocument }
  | { kind: 'read_only'; reason: ReadOnlyReason; document: DefinitionDocument };

export const getEditability = (record: EntityDefinitionRecord): Editability => {
  const { definition, source, inventorySource } = record;
  if (source === 'api') {
    const { id, ...withoutId } = definition;
    return { kind: 'definition', document: withoutId };
  }
  if (source === 'built_in' && inventorySource === 'api') {
    return {
      kind: 'extension',
      document: { extends: definition.type, inventory: definition.inventory },
    };
  }
  if (source === 'built_in') {
    return {
      kind: 'read_only',
      reason: inventorySource === 'code' ? 'built_in_code_extension' : 'built_in_without_extension',
      document: definition as unknown as DefinitionDocument,
    };
  }
  return {
    kind: 'read_only',
    reason: 'code',
    document: definition as unknown as DefinitionDocument,
  };
};

export const countSources = (record: EntityDefinitionRecord): number =>
  record.definition.inventory?.sources.length ?? 0;

export const stringifyDocument = (document: unknown): string => JSON.stringify(document, null, 2);

export type ParsedDocument = { document: DefinitionDocument } | { error: string };

/** Parses editor text into a plain object; anything else is reported as an error for the callout. */
export const parseDocument = (text: string): ParsedDocument => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'The document must be a JSON object' };
  }
  return { document: parsed as DefinitionDocument };
};

/** The type a saved document registers under: `type` for a definition, `extends` for an extension. */
export const getDocumentType = (document: DefinitionDocument): string | undefined => {
  const candidate = 'extends' in document ? document.extends : document.type;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
};

export type TemplateKind = 'definition' | 'extension';

export const DEFINITION_TEMPLATE: DefinitionDocument = {
  type: 'my.type',
  name: "Observability 'my.type' inventory definition",
  identityField: { singleField: 'my.identity.field' },
  materialisation: { mode: 'none' },
  inventory: {
    label: 'My type',
    attributes: ['my.attribute.field'],
    sources: [
      {
        index: 'metrics-*',
        metrics: [{ name: 'my_metric', field: 'my.metric.field', agg: 'avg' }],
      },
    ],
  },
};

export const EXTENSION_TEMPLATE: DefinitionDocument = {
  extends: 'host',
  inventory: {
    label: 'Host',
    attributes: ['host.os.name'],
    sources: [
      {
        index: 'metrics-system.*',
        filter: 'metricset.name IN ("cpu", "memory")',
        metrics: [{ name: 'cpu_pct', field: 'system.cpu.total.norm.pct', agg: 'avg' }],
      },
    ],
  },
};

/** The blank document for "New"; an extension template may target a given built-in type. */
export const getTemplate = (kind: TemplateKind, extendsType?: string): DefinitionDocument =>
  kind === 'definition'
    ? DEFINITION_TEMPLATE
    : { ...EXTENSION_TEMPLATE, extends: extendsType ?? EXTENSION_TEMPLATE.extends };
