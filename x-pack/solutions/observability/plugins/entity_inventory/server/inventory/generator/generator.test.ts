/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  ALL_FIXTURES,
  RANGE,
  claimDefinition,
  deploymentDefinition,
  hostDefinition,
  hostFilteredMetricsDefinition,
  podDefinition,
} from '../__fixtures__/definitions';
import {
  buildColumns,
  buildCountQuery,
  buildSourceQuery,
  getInventory,
  metricExpression,
  metricPresenceFilter,
  planSources,
  resolveIdentityPlan,
  validateEsqlFilter,
  quoteIdentifier,
  isSafeIndexPattern,
  InventoryDefinitionError,
} from '.';

const listOptions = { range: RANGE, limit: 100, pushDownSort: false };

describe('generator', () => {
  describe.each(ALL_FIXTURES.map((definition) => [definition.type, definition] as const))(
    '%s',
    (_type, definition) => {
      const identity = resolveIdentityPlan(definition);
      const sources = getInventory(definition).sources;

      it('identity plan and columns', () => {
        expect({ identity, columns: buildColumns(definition, identity) }).toMatchSnapshot();
      });

      it.each(sources.map((source, index) => [index, source.index] as const))(
        'list query for source %i (%s) under TS and FROM',
        (index) => {
          const source = sources[index];
          const ts = buildSourceQuery(definition, identity, { source, engine: 'TS' }, listOptions);
          const from = buildSourceQuery(
            definition,
            identity,
            { source, engine: 'FROM' },
            listOptions
          );
          expect(ts).toMatchSnapshot('TS');
          expect(from).toMatchSnapshot('FROM');
          for (const { esql } of [ts, from]) {
            expect(esql).not.toMatch(/NOW\(\)/);
            // Never aggregate over the `_id` metadata field (identity fields such as `claim_id` are fine).
            expect(esql).not.toMatch(/\b_id\b/);
            // No EVAL before STATS: identity is grouped on raw fields, the id is computed after.
            expect(esql.indexOf('| EVAL')).toBeGreaterThan(esql.indexOf('| STATS'));
            expect(esql.startsWith('SET unmapped_fields="nullify";')).toBe(true);
          }
          expect(from.esql).not.toMatch(/_OVER_TIME/);
        }
      );

      it('count query', () => {
        expect(buildCountQuery(definition, identity, sources, RANGE)).toMatchSnapshot();
      });
    }
  );

  it('pushes the sort and limit down for a single source, otherwise sorts by last_seen at the cap', () => {
    const identity = resolveIdentityPlan(podDefinition);
    const source = getInventory(podDefinition).sources[0];
    const pushed = buildSourceQuery(
      podDefinition,
      identity,
      { source, engine: 'TS' },
      {
        range: RANGE,
        limit: 25,
        pushDownSort: true,
        sort: { column: 'cpu_cores', direction: 'asc' },
      }
    );
    expect(pushed.esql).toContain('| SORT `cpu_cores` ASC NULLS LAST\n| LIMIT 25');
    const notPushed = buildSourceQuery(
      podDefinition,
      identity,
      { source, engine: 'TS' },
      {
        range: RANGE,
        limit: 25,
        pushDownSort: false,
        sort: { column: 'cpu_cores', direction: 'asc' },
      }
    );
    expect(notPushed.esql).toContain('| SORT `last_seen` DESC NULLS LAST\n| LIMIT 10000');
    // A sort column this source does not produce falls back to last_seen even when pushing down.
    const other = buildSourceQuery(
      podDefinition,
      identity,
      { source, engine: 'TS' },
      { range: RANGE, limit: 25, pushDownSort: true, sort: { column: 'phase', direction: 'asc' } }
    );
    expect(other.esql).toContain('| SORT `last_seen` DESC NULLS LAST\n| LIMIT 25');
  });

  it('plans filtered metrics into exactly the queries the duplicated-source spelling generates', () => {
    const identity = resolveIdentityPlan(hostFilteredMetricsDefinition);
    const planned = planSources(getInventory(hostFilteredMetricsDefinition).sources);
    const handSplit = getInventory(hostDefinition).sources;
    expect(planned).toHaveLength(handSplit.length);

    for (const engine of ['TS', 'FROM'] as const) {
      planned.forEach((source, index) => {
        expect(
          buildSourceQuery(hostFilteredMetricsDefinition, identity, { source, engine }, listOptions)
        ).toEqual(
          buildSourceQuery(
            hostDefinition,
            identity,
            { source: handSplit[index], engine },
            listOptions
          )
        );
      });
    }
    // The same output columns, in the same order, and the same exact count.
    expect(buildColumns(hostFilteredMetricsDefinition, identity)).toEqual(
      buildColumns(hostDefinition, identity)
    );
    expect(buildCountQuery(hostFilteredMetricsDefinition, identity, planned, RANGE)).toEqual(
      buildCountQuery(hostDefinition, identity, handSplit, RANGE)
    );
  });

  it('detail queries bind identity values as named parameters', () => {
    const identity = resolveIdentityPlan(deploymentDefinition);
    const source = getInventory(deploymentDefinition).sources[0];
    const query = buildSourceQuery(
      deploymentDefinition,
      identity,
      { source, engine: 'TS' },
      {
        ...listOptions,
        identityValues: {
          'kubernetes.namespace': 'payments',
          'kubernetes.deployment.name': 'checkout"api',
        },
      }
    );
    expect(query.esql).toContain('`kubernetes.namespace` == ?id_0');
    expect(query.esql).toContain('`kubernetes.deployment.name` == ?id_1');
    expect(query.esql).not.toContain('checkout');
    expect(query.params).toEqual([
      { from: RANGE.from },
      { to: RANGE.to },
      { id_0: 'payments' },
      { id_1: 'checkout"api' },
    ]);
    expect(() =>
      buildSourceQuery(
        deploymentDefinition,
        identity,
        { source, engine: 'TS' },
        { ...listOptions, identityValues: { 'kubernetes.pod.name': 'x' } }
      )
    ).toThrow(InventoryDefinitionError);
  });

  it.each(['TS', 'FROM'] as const)(
    'buckets detail metrics under %s after identity filtering',
    (engine) => {
      const identity = resolveIdentityPlan(hostDefinition);
      const source = getInventory(hostDefinition).sources[0];
      const { esql, params } = buildSourceQuery(
        hostDefinition,
        identity,
        { source, engine },
        {
          ...listOptions,
          identityValues: { 'host.id': 'host-a' },
          timeBucket: { column: 'bucket', targetBuckets: 250 },
        }
      );
      expect(esql).toContain(
        'BY `host.id`, `host.name`, `host.hostname`, `bucket` = BUCKET(@timestamp, 250, ?from, ?to)'
      );
      expect(esql).toContain('`host.id` == ?id_0');
      expect(esql).toContain('state == "idle"');
      expect(esql).toContain('`system.cpu.utilization` IS NOT NULL');
      expect(esql).toContain(
        '`host.os.name` = LAST(`host.os.name`, @timestamp) WHERE `host.os.name` IS NOT NULL'
      );
      expect(esql).toContain('| EVAL `cpu_pct` = `cpu_pct` * -1.0 + 1.0');
      expect(esql).toContain(
        engine === 'TS'
          ? 'AVG(AVG_OVER_TIME(`system.cpu.utilization`))'
          : 'AVG(`system.cpu.utilization`)'
      );
      expect(esql.indexOf('| EVAL')).toBeGreaterThan(esql.indexOf('| STATS'));
      expect(esql).toContain('`last_seen`, `bucket`\n| SORT');
      expect(esql).toContain('| LIMIT 10000');
      expect(params).toEqual([{ from: RANGE.from }, { to: RANGE.to }, { id_0: 'host-a' }]);
    }
  );

  it('ranked identities group by every ranking field and compute the id afterwards', () => {
    const identity = resolveIdentityPlan(hostDefinition);
    expect(identity.kind).toBe('ranking');
    expect(identity.fields).toEqual(['host.id', 'host.name', 'host.hostname']);
    expect(identity.presenceFilter).toBe(
      '(`host.id` IS NOT NULL OR `host.name` IS NOT NULL OR `host.hostname` IS NOT NULL)'
    );
    const source = getInventory(hostDefinition).sources[2];
    const { esql } = buildSourceQuery(
      hostDefinition,
      identity,
      { source, engine: 'TS' },
      listOptions
    );
    expect(esql).toContain('BY `host.id`, `host.name`, `host.hostname`');
    expect(esql).toContain('CONCAT("host:"');
    // A numeric path segment is quoted, otherwise `.1` parses as a number.
    expect(esql).toContain('`system.load.1`');
  });

  it('builds the metric presence filter from value metrics only', () => {
    expect(metricPresenceFilter(getInventory(deploymentDefinition).sources[0])).toBe(
      '(`k8s.pod.cpu.usage` IS NOT NULL)'
    );
    expect(
      metricPresenceFilter({
        index: 'x',
        metrics: [
          { name: 'pods', field: 'kubernetes.pod.name', agg: 'count_distinct' },
          { name: 'nodes', field: 'kubernetes.node.name', agg: 'count_distinct' },
        ],
      })
    ).toBe('(`kubernetes.pod.name` IS NOT NULL OR `kubernetes.node.name` IS NOT NULL)');
    // A log-volume count does not define existence next to a value metric.
    expect(
      metricPresenceFilter({
        index: 'x',
        metrics: [
          { name: 'log_lines', field: '@timestamp', agg: 'count' },
          { name: 'latency', field: 'transaction.duration.summary', agg: 'avg' },
        ],
      })
    ).toBe('(`transaction.duration.summary` IS NOT NULL)');
    expect(metricPresenceFilter({ index: 'x' })).toBeUndefined();
  });

  it('applies scale and offset on the aggregated rows', () => {
    const identity = resolveIdentityPlan(hostDefinition);
    const source = {
      index: 'metrics-hostmetricsreceiver.otel-default',
      filter: 'state == "idle"',
      metrics: [
        {
          name: 'cpu_pct',
          field: 'system.cpu.utilization',
          agg: 'avg' as const,
          scale: -1,
          offset: 1,
        },
        { name: 'mem_gb', field: 'system.memory.usage', agg: 'avg' as const, scale: 1e-9 },
      ],
    };
    const { esql } = buildSourceQuery(
      hostDefinition,
      identity,
      { source, engine: 'TS' },
      listOptions
    );
    expect(esql).toContain(
      '| EVAL `cpu_pct` = `cpu_pct` * -1.0 + 1.0, `mem_gb` = `mem_gb` * 1.0E-9'
    );
    expect(esql.indexOf('| EVAL `cpu_pct`')).toBeGreaterThan(esql.indexOf('| STATS'));
  });

  it('authored ranked identities group by every alternative and resolve the first present one', () => {
    const identity = resolveIdentityPlan(claimDefinition);
    expect(identity.kind).toBe('ranking');
    expect(identity.fields).toEqual(['halcyon.claim_id', 'claim_id']);
    expect(identity.presenceFilter).toBe(
      '(`halcyon.claim_id` IS NOT NULL OR `claim_id` IS NOT NULL)'
    );
    const [traces, logs] = getInventory(claimDefinition).sources;
    const t = buildSourceQuery(
      claimDefinition,
      identity,
      { source: traces, engine: 'FROM' },
      listOptions
    ).esql;
    const l = buildSourceQuery(
      claimDefinition,
      identity,
      { source: logs, engine: 'FROM' },
      listOptions
    ).esql;
    for (const esql of [t, l]) {
      expect(esql).toContain('BY `halcyon.claim_id`, `claim_id`');
      expect(esql).toContain('CONCAT("claim:"');
    }
  });

  it('counts ranked identities by resolved id, tuples by group', () => {
    const ranked = buildCountQuery(
      claimDefinition,
      resolveIdentityPlan(claimDefinition),
      getInventory(claimDefinition).sources,
      RANGE
    ).esql;
    expect(ranked).toContain('| STATS BY `halcyon.claim_id`, `claim_id`\n| EVAL ');
    expect(ranked).toContain('| STATS `count` = COUNT_DISTINCT(`entity.id`)');
    const tuple = buildCountQuery(
      podDefinition,
      resolveIdentityPlan(podDefinition),
      getInventory(podDefinition).sources,
      RANGE
    ).esql;
    expect(tuple).toContain('| STATS BY `kubernetes.pod.uid`\n| STATS `count` = COUNT(*)');
  });

  it('maps metric aggregations per engine', () => {
    const metric = { name: 'm', field: 'f.x', agg: 'avg' } as const;
    expect(metricExpression(metric, 'TS')).toBe('AVG(AVG_OVER_TIME(`f.x`))');
    expect(metricExpression(metric, 'FROM')).toBe('AVG(`f.x`)');
    expect(metricExpression({ ...metric, agg: 'sum' }, 'TS')).toBe('SUM(SUM_OVER_TIME(`f.x`))');
    expect(metricExpression({ ...metric, agg: 'count_distinct' }, 'TS')).toBe(
      'COUNT_DISTINCT(`f.x`)'
    );
    expect(metricExpression({ ...metric, agg: 'count' }, 'TS')).toBe('SUM(COUNT_OVER_TIME(`f.x`))');
    expect(metricExpression({ ...metric, agg: 'count' }, 'FROM')).toBe('COUNT(`f.x`)');
    expect(metricExpression({ ...metric, agg: 'last' }, 'TS')).toBe(
      'LAST(`f.x`, @timestamp) WHERE `f.x` IS NOT NULL'
    );
    expect(metricExpression({ ...metric, agg: 'last' }, 'FROM')).toBe(
      metricExpression({ ...metric, agg: 'last' }, 'TS')
    );
  });

  it('validates source filters as single boolean expressions', () => {
    expect(validateEsqlFilter('metricset.name IN ("pod", "state_pod")')).toBeUndefined();
    expect(validateEsqlFilter('k8s.pod.phase IS NOT NULL')).toBeUndefined();
    expect(validateEsqlFilter('a == 1 | DROP b')).toContain('pipe');
    expect(validateEsqlFilter('a == 1 // c')).toContain('comment');
    expect(validateEsqlFilter('a == 1 /* c */')).toContain('comment');
    expect(validateEsqlFilter('a == 1 ; SET x=1')).toContain('semicolon');
    expect(validateEsqlFilter('a == 1, b')).toContain('does not parse');
    const identity = resolveIdentityPlan(podDefinition);
    const source = { ...getInventory(podDefinition).sources[0], filter: 'x == 1 | DROP y' };
    expect(() =>
      buildSourceQuery(podDefinition, identity, { source, engine: 'TS' }, listOptions)
    ).toThrow(InventoryDefinitionError);
  });

  it('refuses to generate from a source whose metrics still carry a filter', () => {
    // Unplanned, the filter would be dropped and `cpu_pct` aggregated over every state.
    const identity = resolveIdentityPlan(hostFilteredMetricsDefinition);
    const [source] = getInventory(hostFilteredMetricsDefinition).sources;
    expect(() =>
      buildSourceQuery(
        hostFilteredMetricsDefinition,
        identity,
        { source, engine: 'TS' },
        listOptions
      )
    ).toThrow('metric "cpu_pct" carries a filter');
    expect(() => buildCountQuery(hostFilteredMetricsDefinition, identity, [source], RANGE)).toThrow(
      InventoryDefinitionError
    );
  });

  it('quotes identifiers and rejects unsafe index patterns', () => {
    expect(quoteIdentifier('last')).toBe('`last`');
    expect(quoteIdentifier('a`b')).toBe('`a``b`');
    expect(isSafeIndexPattern('metrics-kubernetes.pod-*')).toBe(true);
    expect(isSafeIndexPattern('remote:metrics-*')).toBe(true);
    expect(isSafeIndexPattern('metrics-* | DROP x')).toBe(false);
    expect(isSafeIndexPattern('-metrics')).toBe(false);
    const identity = resolveIdentityPlan(podDefinition);
    const source = { ...getInventory(podDefinition).sources[0], index: 'metrics-* | DROP x' };
    expect(() =>
      buildSourceQuery(podDefinition, identity, { source, engine: 'TS' }, listOptions)
    ).toThrow(InventoryDefinitionError);
  });
});
