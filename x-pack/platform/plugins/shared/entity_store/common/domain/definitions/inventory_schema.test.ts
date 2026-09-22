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

  it.each([
    ['identity', ['kubernetes.pod.uid']],
    ['identityMode', 'ranked'],
  ])(
    'rejects the removed key %s: identityField is the single identity declaration',
    (key, value) => {
      const result = inventoryExtensionSchema.safeParse({ ...minimalInventory, [key]: value });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toMatch(new RegExp(`Unrecognized key.*${key}`));
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

  it('rejects a per-source attribute name that repeats a top-level attribute', () => {
    const result = inventoryExtensionSchema.safeParse({
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
      ['sources', 0, 'attributes', 1, 'name'],
    ]);
    expect(result.error?.issues[0].message).toContain('repeats a top-level attribute');
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

  it('bounds the queries a list runs, counting one per distinct metric filter', () => {
    const metrics = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        name: `cpu_${index}`,
        field: 'system.cpu.utilization',
        agg: 'avg' as const,
        filter: `state == "s${index}"`,
      }));
    // 16 sources are fine while each is one query, but 2 sources of 17 filters are 34.
    expect(
      inventoryExtensionSchema.safeParse({
        sources: Array.from({ length: 16 }, () => ({
          index: 'metrics-*',
          metrics: [{ name: 'cpu', field: 'system.cpu.utilization', agg: 'avg' }],
        })),
      }).success
    ).toBe(true);
    const result = inventoryExtensionSchema.safeParse({
      sources: [
        { index: 'metrics-*', metrics: metrics(17) },
        { index: 'metrics-other-*', metrics: metrics(17) },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain('expand to 34 queries');
    // Metrics sharing a filter share a query, so the same 34 metrics fit in 2.
    expect(
      inventoryExtensionSchema.safeParse({
        sources: [
          {
            index: 'metrics-*',
            metrics: metrics(17).map((metric) => ({ ...metric, filter: 'state == "idle"' })),
          },
          {
            index: 'metrics-other-*',
            metrics: metrics(17).map((metric) => ({ ...metric, filter: 'state == "idle"' })),
          },
        ],
      }).success
    ).toBe(true);
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

  it('is the authored extension schema: label, attributes and sources, never an identity', () => {
    expect(builtInInventoryExtensionSchema).toBe(inventoryExtensionSchema);
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

  it('accepts a per-metric filter, so one source can carry several dimension values of a field', () => {
    const result = inventorySourceSchema.safeParse({
      index: 'metrics-hostmetricsreceiver.otel-default',
      metrics: [
        {
          name: 'cpu_busy_pct',
          field: 'system.cpu.utilization',
          agg: 'avg',
          filter: 'state == "idle"',
          scale: -1,
          offset: 1,
          unit: 'ratio',
        },
        { name: 'load_1m', field: 'system.cpu.load_average.1m', agg: 'avg', unit: 'load' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('bounds a metric filter like a source filter', () => {
    expect(
      inventorySourceSchema.safeParse({
        index: 'metrics-*',
        metrics: [{ name: 'cpu', field: 'system.cpu.utilization', agg: 'avg', filter: '' }],
      }).success
    ).toBe(false);
    expect(
      inventorySourceSchema.safeParse({
        index: 'metrics-*',
        metrics: [
          { name: 'cpu', field: 'system.cpu.utilization', agg: 'avg', filter: 'x'.repeat(2001) },
        ],
      }).success
    ).toBe(false);
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

  it('accepts the count aggregation', () => {
    expect(
      inventorySourceSchema.safeParse({
        index: 'logs-*',
        metrics: [{ name: 'log_lines', field: '@timestamp', agg: 'count', unit: 'count' }],
      }).success
    ).toBe(true);
  });

  it('accepts scale with offset (busy = 1 - idle) and rejects offset on counts', () => {
    expect(
      inventorySourceSchema.safeParse({
        index: 'metrics-*',
        filter: 'state == "idle"',
        metrics: [
          {
            name: 'cpu_pct',
            field: 'system.cpu.utilization',
            agg: 'avg',
            scale: -1,
            offset: 1,
            unit: 'ratio',
          },
        ],
      }).success
    ).toBe(true);
    expect(
      inventorySourceSchema.safeParse({
        index: 'metrics-*',
        metrics: [{ name: 'n', field: 'f', agg: 'count', offset: 1 }],
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
