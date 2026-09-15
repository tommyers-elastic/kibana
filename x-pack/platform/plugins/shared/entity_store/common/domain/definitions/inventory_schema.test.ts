/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { INVENTORY_DEFINITION_FIXTURES } from './__fixtures__/inventory_definitions';
import {
  inventoryDurationSchema,
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

  it('rejects unknown keys so authoring typos and unported prototype keys fail loudly', () => {
    expect(inventoryExtensionSchema.safeParse({ ...minimalInventory, edges: [] }).success).toBe(
      false
    );
    expect(
      inventoryExtensionSchema.safeParse({ ...minimalInventory, derivedMetadata: [] }).success
    ).toBe(false);
  });

  it('requires at least one source', () => {
    expect(inventoryExtensionSchema.safeParse({ ...minimalInventory, sources: [] }).success).toBe(
      false
    );
  });

  it('rejects an invalid inventory window', () => {
    expect(
      inventoryExtensionSchema.safeParse({ ...minimalInventory, inventoryWindow: 'fifteen' })
        .success
    ).toBe(false);
    expect(
      inventoryExtensionSchema.safeParse({ ...minimalInventory, inventoryWindow: '0m' }).success
    ).toBe(false);
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

describe('inventoryDurationSchema', () => {
  it.each(['15m', '1h', '30s', '7d'])('accepts %s', (duration) => {
    expect(inventoryDurationSchema.safeParse(duration).success).toBe(true);
  });

  it.each(['15', 'm', '1.5h', '15 m', '-1m', '1w'])('rejects %s', (duration) => {
    expect(inventoryDurationSchema.safeParse(duration).success).toBe(false);
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
