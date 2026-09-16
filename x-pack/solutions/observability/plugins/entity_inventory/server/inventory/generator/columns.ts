/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { EntityDefinition, InventorySource } from '@kbn/entity-store/common';
import { ENTITY_ID_COLUMN, LAST_SEEN_COLUMN, type InventoryColumn } from '../../../common';
import type { IdentityPlan } from './identity';

export class InventoryDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InventoryDefinitionError';
  }
}

export const getInventory = (definition: EntityDefinition) => {
  const { inventory } = definition;
  if (!inventory) {
    throw new InventoryDefinitionError(
      `Entity type "${definition.type}" has no inventory extension`
    );
  }
  return inventory;
};

/**
 * Output columns of a type in display order: entity id, identity fields, top-level attributes
 * (named by their field), per-source attributes and metrics (named, first appearance wins, later
 * sources add their field as a variant), `last_seen`.
 */
export const buildColumns = (
  definition: EntityDefinition,
  identity: IdentityPlan
): InventoryColumn[] => {
  const inventory = getInventory(definition);
  const columns: InventoryColumn[] = [{ name: ENTITY_ID_COLUMN, kind: 'entity_id' }];
  for (const field of identity.fields) {
    columns.push({ name: field, kind: 'identity', fields: [field] });
  }
  for (const field of inventory.attributes ?? []) {
    columns.push({ name: field, kind: 'attribute', fields: [field] });
  }
  const named = new Map<string, InventoryColumn>();
  const addNamed = (name: string, kind: 'attribute' | 'metric', field: string, unit?: string) => {
    const existing = named.get(name);
    if (existing) {
      if (!existing.fields?.includes(field)) {
        existing.fields = [...(existing.fields ?? []), field];
      }
      if (existing.unit === undefined && unit !== undefined) {
        existing.unit = unit;
      }
      return;
    }
    const column: InventoryColumn = { name, kind, fields: [field], ...(unit ? { unit } : {}) };
    named.set(name, column);
    columns.push(column);
  };
  for (const source of inventory.sources) {
    for (const attribute of source.attributes ?? []) {
      addNamed(attribute.name, 'attribute', attribute.field);
    }
  }
  for (const source of inventory.sources) {
    for (const metric of source.metrics ?? []) {
      addNamed(metric.name, 'metric', metric.field, metric.unit);
    }
  }
  columns.push({ name: LAST_SEEN_COLUMN, kind: 'last_seen' });
  return columns;
};

/** The subset of output columns one source produces, in the same order as {@link buildColumns}. */
export const sourceColumnNames = (
  definition: EntityDefinition,
  identity: IdentityPlan,
  source: InventorySource
): string[] => {
  const inventory = getInventory(definition);
  return [
    ENTITY_ID_COLUMN,
    ...identity.fields,
    ...(inventory.attributes ?? []),
    ...(source.attributes ?? []).map(({ name }) => name),
    ...(source.metrics ?? []).map(({ name }) => name),
    LAST_SEEN_COLUMN,
  ];
};
