/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { EuiProvider } from '@elastic/eui';
import { Axis, Fit, LineSeries } from '@elastic/charts';
import type { InventoryDetailResponse } from '../../common';
import { EntityMetricCharts } from './entity_metric_charts';

jest.mock('@elastic/charts', () => ({
  ...jest.requireActual('@elastic/charts'),
  Chart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Settings: () => null,
  Axis: jest.fn(() => null),
  Tooltip: () => null,
  LineSeries: jest.fn(() => null),
}));

const result: InventoryDetailResponse = {
  type: 'host',
  columns: [
    { name: 'name', kind: 'attribute' },
    { name: 'cpu', kind: 'metric', unit: 'cores' },
    { name: 'memory', kind: 'metric', unit: 'bytes' },
  ],
  rows: [],
  provenance: {
    a: { cpu: 'metrics-kubeletstatsreceiver.otel-default' },
    b: { cpu: 'metrics-kubernetes.pod-*' },
  },
  total: 1,
  truncated: false,
  tookMs: 1,
  esTookMs: 1,
  queries: [],
  unavailableColumns: [],
  unsupportedMetrics: [],
  errors: [],
  timeSeries: {
    from: '2026-09-21T13:20:16Z',
    to: '2026-09-21T14:20:16Z',
    targetBuckets: 250,
    points: [
      { entityId: 'a', timestamp: '2026-09-21T13:20:00Z', metrics: { cpu: 0, memory: null } },
      { entityId: 'b', timestamp: '2026-09-21T13:20:00Z', metrics: { cpu: 999, memory: 999 } },
      { entityId: 'a', timestamp: '2026-09-21T13:20:30Z', metrics: { cpu: null, memory: null } },
      { entityId: 'a', timestamp: '2026-09-21T13:21:30Z', metrics: { cpu: 2, memory: null } },
    ],
  },
};

describe('entity metric charts', () => {
  beforeEach(() => jest.clearAllMocks());

  it('plots only the selected entity, preserving zero, null and sparse timestamps', () => {
    render(
      <EuiProvider>
        <EntityMetricCharts entityId="a" result={result} />
      </EuiProvider>
    );
    expect(screen.getByText('cpu')).toBeInTheDocument();
    expect(screen.queryByText('name')).not.toBeInTheDocument();
    expect(LineSeries).toHaveBeenCalledTimes(1);
    expect(LineSeries).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'cpu',
        fit: Fit.Linear,
        lineSeriesStyle: {
          point: { visible: 'auto' },
          fit: { line: { visible: true, opacity: 1, dash: [] } },
        },
        data: [
          { timestamp: Date.parse('2026-09-21T13:20:00Z'), value: 0 },
          { timestamp: Date.parse('2026-09-21T13:20:30Z'), value: null },
          { timestamp: Date.parse('2026-09-21T13:21:30Z'), value: 2 },
        ],
      }),
      expect.anything()
    );
    expect(screen.getByText('memory')).toBeInTheDocument();
    expect(screen.getByText('No samples in this time window.')).toBeInTheDocument();
  });

  it('subtitles each chart with the source that supplied its series and omits it when there is none', () => {
    render(
      <EuiProvider>
        <EntityMetricCharts entityId="a" result={result} />
      </EuiProvider>
    );
    const subtitles = screen.getAllByTestId('entityInventoryMetricChartSource');
    expect(subtitles).toHaveLength(1);
    expect(subtitles[0]).toHaveTextContent('Source: metrics-kubeletstatsreceiver.otel-default');
  });

  it('formats metric axes using the declared units', () => {
    render(
      <EuiProvider>
        <EntityMetricCharts entityId="a" result={result} />
      </EuiProvider>
    );
    const valueAxis = jest.mocked(Axis).mock.calls.find(([props]) => props.id === 'value')?.[0];
    expect(valueAxis?.tickFormat?.(0.25)).toBe('0.25 cores');
  });

  it('does not render charts for an attribute-only definition', () => {
    render(
      <EuiProvider>
        <EntityMetricCharts
          entityId="a"
          result={{ ...result, columns: [{ name: 'name', kind: 'attribute' }] }}
        />
      </EuiProvider>
    );
    expect(screen.queryByText('Metrics over time')).not.toBeInTheDocument();
    expect(LineSeries).not.toHaveBeenCalled();
  });
});
