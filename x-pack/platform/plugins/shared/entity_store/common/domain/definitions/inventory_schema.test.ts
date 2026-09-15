/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { INVENTORY_DEFINITION_FIXTURES } from './__fixtures__/inventory_definitions';
import {
  inventoryExtensionSchema,
  inventorySourceSchema,
  isLiteralFieldPath,
} from './inventory_schema';

const minimalInventory = {
  identity: ['kubernetes.pod.uid'],
  sources: [{ index: 'metrics-kubeletstatsreceiver.otel-default', engine: 'TS' }],
};

describe('inventoryExtensionSchema', () => {
  it('accepts a minimal inventory extension', () => {
    expect(inventoryExtensionSchema.safeParse(minimalInventory).success).toBe(true);
  });

  it.each(INVENTORY_DEFINITION_FIXTURES.map((definition) => [definition.type, definition]))(
    'accepts the ported %s fixture',
    (_type, definition) => {
      const result = inventoryExtensionSchema.safeParse(definition.inventory);
      expect(result.error?.issues).toBeUndefined();
      expect(result.success).toBe(true);
    }
  );

  it('rejects an empty identity', () => {
    expect(inventoryExtensionSchema.safeParse({ ...minimalInventory, identity: [] }).success).toBe(
      false
    );
  });

  it('rejects duplicate identity fields', () => {
    const result = inventoryExtensionSchema.safeParse({
      ...minimalInventory,
      identity: ['kubernetes.pod.uid', 'kubernetes.pod.uid'],
    });
    expect(result.success).toBe(false);
  });

  it.each(['COUNT(*)', 'kubernetes.*', 'kubernetes pod', '`quoted`'])(
    'rejects identity field "%s" that is not a literal path',
    (field) => {
      expect(
        inventoryExtensionSchema.safeParse({ ...minimalInventory, identity: [field] }).success
      ).toBe(false);
    }
  );

  it('rejects a carry field that repeats an identity field', () => {
    const result = inventoryExtensionSchema.safeParse({
      ...minimalInventory,
      carry: ['kubernetes.pod.uid'],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['carry', 0]);
  });

  it.each([
    ['edges', []],
    ['derivedMetadata', []],
    ['lookups', []],
    ['metadataWrite', { index: 'x', keyFields: ['a'] }],
    ['inventoryWindow', '15m'],
    ['defaultSort', { field: 'last_seen', direction: 'desc' }],
  ])('rejects the deferred or unknown key %s so it fails loudly', (key, value) => {
    expect(inventoryExtensionSchema.safeParse({ ...minimalInventory, [key]: value }).success).toBe(
      false
    );
  });

  it('requires at least one source', () => {
    expect(inventoryExtensionSchema.safeParse({ ...minimalInventory, sources: [] }).success).toBe(
      false
    );
  });
});

describe('inventorySourceSchema', () => {
  it('rejects duplicate metric and capture names within a source', () => {
    const result = inventorySourceSchema.safeParse({
      index: 'metrics-*',
      engine: 'FROM',
      metrics: [{ name: 'phase', esql: 'COUNT(*)' }],
      captures: [{ name: 'phase', esql: 'LAST(kubernetes.pod.status.phase, @timestamp)' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects metric names that are not simple identifiers', () => {
    const result = inventorySourceSchema.safeParse({
      index: 'metrics-*',
      engine: 'FROM',
      metrics: [{ name: 'Cpu Cores', esql: 'COUNT(*)' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown engine', () => {
    expect(inventorySourceSchema.safeParse({ index: 'metrics-*', engine: 'SQL' }).success).toBe(
      false
    );
  });
});

describe('isLiteralFieldPath', () => {
  it.each(['host.name', 'kubernetes.pod.uid', '@timestamp', 'InstanceId', 'cloud-account_id'])(
    'accepts %s',
    (field) => {
      expect(isLiteralFieldPath(field)).toBe(true);
    }
  );

  it.each(['', 'a b', 'a(b)', 'a*', 'a..b', '.a', 'a.', 'a/b', '"a"', "'a'"])(
    'rejects %j',
    (field) => {
      expect(isLiteralFieldPath(field)).toBe(false);
    }
  );
});
