/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { INVENTORY_DEFINITION_FIXTURES } from './__fixtures__/inventory_definitions';
import {
  builtInInventoryExtensionDocumentSchema,
  builtInInventoryExtensionSchema,
  inventoryExtensionSchema,
  isBuiltInInventoryExtensionDocument,
  inventorySourceSchema,
  isLiteralFieldPath,
} from './inventory_schema';

const minimalInventory = {
  identity: ['kubernetes.pod.uid'],
  sources: [{ index: 'metrics-kubeletstatsreceiver.otel-default' }],
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

  it('accepts attributes and a source with structured metrics and a filter', () => {
    const result = inventoryExtensionSchema.safeParse({
      ...minimalInventory,
      attributes: ['kubernetes.pod.name', 'kubernetes.namespace'],
      sources: [
        {
          index: 'metrics-kubernetes.tsdb-default',
          filter: 'metricset.name == "pod"',
          metrics: [{ name: 'cpu_pct', field: 'kubernetes.pod.cpu.usage.node.pct', agg: 'avg' }],
        },
      ],
    });
    expect(result.error?.issues).toBeUndefined();
    expect(result.success).toBe(true);
  });

  it('rejects an attribute that repeats an identity field', () => {
    const result = inventoryExtensionSchema.safeParse({
      ...minimalInventory,
      attributes: ['kubernetes.pod.uid'],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['attributes', 0]);
  });

  it.each(['COUNT(*)', 'kubernetes.*', 'pod name'])(
    'rejects attribute "%s" that is not a literal path',
    (field) => {
      expect(
        inventoryExtensionSchema.safeParse({ ...minimalInventory, attributes: [field] }).success
      ).toBe(false);
    }
  );

  it.each([
    ['edges', []],
    ['derivedMetadata', []],
    ['lookups', []],
    ['metadataWrite', { index: 'x', keyFields: ['a'] }],
    ['inventoryWindow', '15m'],
    ['defaultSort', { field: 'last_seen', direction: 'desc' }],
    ['carry', ['kubernetes.pod.name']],
    ['captures', []],
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

  it('accepts per-source attributes with value labels merged by name across sources', () => {
    const result = inventoryExtensionSchema.safeParse({
      ...minimalInventory,
      sources: [
        {
          index: 'metrics-k8sclusterreceiver.otel-default',
          filter: 'k8s.pod.phase IS NOT NULL',
          attributes: [{ name: 'phase', field: 'k8s.pod.phase', valueLabels: { '2': 'running' } }],
        },
        {
          index: 'metrics-kubernetes.tsdb-default',
          filter: 'metricset.name == "state_pod"',
          attributes: [{ name: 'phase', field: 'kubernetes.pod.status.phase' }],
        },
      ],
    });
    expect(result.error?.issues).toBeUndefined();
    expect(result.success).toBe(true);
  });

  it('rejects a per-source attribute name that repeats an identity field or a top-level attribute', () => {
    const result = inventoryExtensionSchema.safeParse({
      identity: ['uid'],
      attributes: ['name'],
      sources: [
        {
          index: 'metrics-*',
          attributes: [
            { name: 'uid', field: 'k8s.pod.uid' },
            { name: 'name', field: 'k8s.pod.name' },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map(({ path }) => path)).toEqual([
      ['sources', 0, 'attributes', 0, 'name'],
      ['sources', 0, 'attributes', 1, 'name'],
    ]);
  });

  it('accepts the same metric name across sources with scale and unit, and rejects inconsistent agg or unit', () => {
    const consistent = inventoryExtensionSchema.safeParse({
      ...minimalInventory,
      sources: [
        {
          index: 'otel-*',
          metrics: [{ name: 'cpu_cores', field: 'k8s.pod.cpu.usage', agg: 'avg', unit: 'cores' }],
        },
        {
          index: 'ecs-*',
          metrics: [
            {
              name: 'cpu_cores',
              field: 'kubernetes.pod.cpu.usage.nanocores',
              agg: 'avg',
              scale: 1e-9,
              unit: 'cores',
            },
          ],
        },
      ],
    });
    expect(consistent.error?.issues).toBeUndefined();
    const differentAgg = inventoryExtensionSchema.safeParse({
      ...minimalInventory,
      sources: [
        { index: 'otel-*', metrics: [{ name: 'cpu_cores', field: 'a', agg: 'avg' }] },
        { index: 'ecs-*', metrics: [{ name: 'cpu_cores', field: 'b', agg: 'max' }] },
      ],
    });
    expect(differentAgg.error?.issues[0].path).toEqual(['sources', 1, 'metrics', 0, 'agg']);
    const differentUnit = inventoryExtensionSchema.safeParse({
      ...minimalInventory,
      sources: [
        { index: 'otel-*', metrics: [{ name: 'cpu', field: 'a', agg: 'avg', unit: 'cores' }] },
        { index: 'ecs-*', metrics: [{ name: 'cpu', field: 'b', agg: 'avg', unit: 'percent' }] },
      ],
    });
    expect(differentUnit.error?.issues[0].path).toEqual(['sources', 1, 'metrics', 0, 'unit']);
  });

  it('rejects a name used as a metric in one source and as an attribute in another', () => {
    const result = inventoryExtensionSchema.safeParse({
      ...minimalInventory,
      sources: [
        { index: 'a-*', metrics: [{ name: 'phase', field: 'k8s.pod.phase', agg: 'last' }] },
        { index: 'b-*', attributes: [{ name: 'phase', field: 'kubernetes.pod.status.phase' }] },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['sources', 1, 'attributes', 0, 'name']);
  });
});

describe('builtInInventoryExtensionSchema', () => {
  const minimalBuiltInExtension = { sources: [{ index: 'metrics-system.cpu-*' }] };

  it('accepts label, attributes and sources without an identity', () => {
    const result = builtInInventoryExtensionSchema.safeParse({
      label: 'Hosts',
      attributes: ['host.os.name', 'cloud.provider'],
      sources: [
        {
          index: 'metrics-system.cpu-*',
          filter: 'system.cpu.total.norm.pct IS NOT NULL',
          metrics: [{ name: 'cpu_pct', field: 'system.cpu.total.norm.pct', agg: 'avg' }],
        },
      ],
    });
    expect(result.error?.issues).toBeUndefined();
    expect(result.success).toBe(true);
  });

  it('accepts a sources-only extension', () => {
    expect(builtInInventoryExtensionSchema.safeParse(minimalBuiltInExtension).success).toBe(true);
  });

  it('rejects an identity: the built-in core owns it', () => {
    const result = builtInInventoryExtensionSchema.safeParse({
      ...minimalBuiltInExtension,
      identity: ['host.name'],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/Unrecognized key.*identity/);
  });

  it('applies the same bounds as the authored extension', () => {
    expect(
      builtInInventoryExtensionSchema.safeParse({ ...minimalBuiltInExtension, sources: [] }).success
    ).toBe(false);
    expect(
      builtInInventoryExtensionSchema.safeParse({
        ...minimalBuiltInExtension,
        attributes: ['host.os.name', 'host.os.name'],
      }).success
    ).toBe(false);
    expect(
      builtInInventoryExtensionSchema.safeParse({ ...minimalBuiltInExtension, attributes: ['a b'] })
        .success
    ).toBe(false);
    expect(
      builtInInventoryExtensionSchema.safeParse({ ...minimalBuiltInExtension, label: '' }).success
    ).toBe(false);
  });

  it.each([
    ['edges', []],
    ['inventoryWindow', '15m'],
    ['materialisation', { mode: 'none' }],
  ])('rejects the unknown key %s so it fails loudly', (key, value) => {
    expect(
      builtInInventoryExtensionSchema.safeParse({ ...minimalBuiltInExtension, [key]: value })
        .success
    ).toBe(false);
  });
});

describe('builtInInventoryExtensionDocumentSchema', () => {
  const document = { extends: 'host', inventory: { sources: [{ index: 'metrics-system.cpu-*' }] } };

  it('accepts an extends plus inventory document', () => {
    const result = builtInInventoryExtensionDocumentSchema.safeParse(document);
    expect(result.error?.issues).toBeUndefined();
    expect(result.success).toBe(true);
    expect(isBuiltInInventoryExtensionDocument(document)).toBe(true);
    expect(isBuiltInInventoryExtensionDocument({ type: 'k8s.pod' })).toBe(false);
  });

  it('validates extends as a type name but leaves "is it built-in" to the registration rules', () => {
    expect(
      builtInInventoryExtensionDocumentSchema.safeParse({ ...document, extends: 'k8s.pod' }).success
    ).toBe(true);
    expect(
      builtInInventoryExtensionDocumentSchema.safeParse({ ...document, extends: 'Host Type' })
        .success
    ).toBe(false);
  });

  it.each([
    ['type', 'host'],
    ['name', 'Hosts'],
    ['identityField', { singleField: 'host.name' }],
    ['materialisation', { mode: 'none' }],
  ])('rejects the definition key %s on an extension document', (key, value) => {
    expect(
      builtInInventoryExtensionDocumentSchema.safeParse({ ...document, [key]: value }).success
    ).toBe(false);
  });

  it('requires both extends and inventory', () => {
    expect(builtInInventoryExtensionDocumentSchema.safeParse({ extends: 'host' }).success).toBe(
      false
    );
    expect(
      builtInInventoryExtensionDocumentSchema.safeParse({ inventory: document.inventory }).success
    ).toBe(false);
  });
});

describe('inventorySourceSchema', () => {
  it('accepts the last aggregation', () => {
    expect(
      inventorySourceSchema.safeParse({
        index: 'metrics-*',
        metrics: [{ name: 'phase', field: 'k8s.pod.phase', agg: 'last' }],
      }).success
    ).toBe(true);
  });

  it('rejects a metric and an attribute sharing a name within a source', () => {
    const result = inventorySourceSchema.safeParse({
      index: 'metrics-*',
      metrics: [{ name: 'phase', field: 'k8s.pod.phase', agg: 'last' }],
      attributes: [{ name: 'phase', field: 'k8s.pod.phase' }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain('unique within a source');
  });

  it('bounds value labels', () => {
    const tooMany = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`${i}`, 'x']));
    expect(
      inventorySourceSchema.safeParse({
        index: 'metrics-*',
        attributes: [{ name: 'phase', field: 'k8s.pod.phase', valueLabels: tooMany }],
      }).success
    ).toBe(false);
    expect(
      inventorySourceSchema.safeParse({
        index: 'metrics-*',
        attributes: [{ name: 'phase', field: 'k8s.pod.phase', valueLabels: { '1': '' } }],
      }).success
    ).toBe(false);
    expect(
      inventorySourceSchema.safeParse({
        index: 'metrics-*',
        attributes: [{ name: 'Phase', field: 'k8s.pod.phase' }],
      }).success
    ).toBe(false);
  });

  it('rejects a zero or non-finite scale and scale on count_distinct', () => {
    const base = { index: 'metrics-*' };
    expect(
      inventorySourceSchema.safeParse({
        ...base,
        metrics: [{ name: 'm', field: 'f', agg: 'avg', scale: 0 }],
      }).success
    ).toBe(false);
    expect(
      inventorySourceSchema.safeParse({
        ...base,
        metrics: [{ name: 'm', field: 'f', agg: 'avg', scale: 1e-9 }],
      }).success
    ).toBe(true);
    expect(
      inventorySourceSchema.safeParse({
        ...base,
        metrics: [{ name: 'm', field: 'f', agg: 'count_distinct', scale: 2 }],
      }).success
    ).toBe(false);
  });

  it('rejects duplicate metric names within a source', () => {
    const result = inventorySourceSchema.safeParse({
      index: 'metrics-*',
      metrics: [
        { name: 'cpu', field: 'k8s.pod.cpu.usage', agg: 'avg' },
        { name: 'cpu', field: 'kubernetes.pod.cpu.usage.node.pct', agg: 'avg' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects metric names that are not simple identifiers', () => {
    const result = inventorySourceSchema.safeParse({
      index: 'metrics-*',
      metrics: [{ name: 'Cpu Cores', field: 'k8s.pod.cpu.usage', agg: 'avg' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown aggregation and a non-literal metric field', () => {
    expect(
      inventorySourceSchema.safeParse({
        index: 'metrics-*',
        metrics: [{ name: 'cpu', field: 'k8s.pod.cpu.usage', agg: 'rate' }],
      }).success
    ).toBe(false);
    expect(
      inventorySourceSchema.safeParse({
        index: 'metrics-*',
        metrics: [{ name: 'cpu', field: 'AVG(k8s.pod.cpu.usage)', agg: 'avg' }],
      }).success
    ).toBe(false);
  });

  it.each(['engine', 'captures', 'esql'])('rejects the removed source key %s', (key) => {
    expect(inventorySourceSchema.safeParse({ index: 'metrics-*', [key]: 'x' }).success).toBe(false);
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
