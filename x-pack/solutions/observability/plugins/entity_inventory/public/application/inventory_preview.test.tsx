/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { EuiProvider } from '@elastic/eui';
import type { InventoryApi } from '../lib/inventory_api';
import type { InventoryDetailResponse, InventoryListResponse } from '../../common';
import { InventoryPreview } from './inventory_preview';
import { EntityMetricCharts } from './entity_metric_charts';

jest.mock('./entity_metric_charts', () => ({
  EntityMetricCharts: jest.fn(() => <div data-test-subj="entityMetricCharts" />),
}));

const timeSeries: InventoryDetailResponse['timeSeries'] = {
  from: '2026-09-21T13:20:16Z',
  to: '2026-09-21T14:20:16Z',
  targetBuckets: 250,
  points: [],
};

const response: InventoryListResponse = {
  type: 'service',
  columns: [],
  rows: [],
  provenance: {},
  total: 0,
  truncated: false,
  tookMs: 1,
  esTookMs: 1,
  queries: [
    {
      index: 'traces-*',
      engine: 'FROM',
      esql: 'FROM traces-*',
      tookMs: 1,
      documentsFound: 0,
      rows: 0,
    },
  ],
  unavailableColumns: [],
  unsupportedMetrics: [],
  errors: [],
  documentFilterWarnings: [
    {
      sourcePatterns: ['traces-*'],
      code: 'source_excluded',
      fields: ['environment'],
      excludedIndices: ['traces-1'],
      eligibleIndexCount: 1,
      columns: ['latency'],
    },
  ],
};

const setup = (listResponse = response) => {
  const api = {
    list: jest
      .fn<ReturnType<InventoryApi['list']>, Parameters<InventoryApi['list']>>()
      .mockResolvedValue(listResponse),
    detail: jest
      .fn<ReturnType<InventoryApi['detail']>, Parameters<InventoryApi['detail']>>()
      .mockResolvedValue({ ...listResponse, timeSeries }),
    types: jest.fn(),
    documentCounts: jest.fn().mockResolvedValue({ type: 'service', from: '', to: '', counts: [] }),
  };
  render(
    <EuiProvider>
      <InventoryPreview
        type="service"
        isAvailable
        api={api}
        identity={{
          kind: 'ranking',
          fields: ['service.id', 'service.name', 'service.environment'],
          compositions: [['service.id'], ['service.name', 'service.environment']],
        }}
      />
    </EuiProvider>
  );
  return api;
};

describe('inventory document filtering', () => {
  it('sends the KQL filter on Run and displays source warnings separately from local search', async () => {
    const api = setup();
    fireEvent.change(screen.getByTestId('entityInventoryDocumentFilter'), {
      target: { value: 'environment: prod' },
    });
    expect(api.list).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await screen.findByText('Document filter excludes some data sources');
    expect(screen.getByText(/traces-\*: the filter cannot match/)).toBeInTheDocument();
    expect(screen.getByText(/Attributes and metrics.*latency/)).toBeInTheDocument();
    expect(api.list).toHaveBeenCalledWith(
      'service',
      expect.objectContaining({ documentFilter: expect.any(Object) })
    );
    expect(JSON.stringify(api.list.mock.calls[0][1].documentFilter)).toContain('environment');
    fireEvent.change(screen.getByPlaceholderText('Filter the returned rows'), {
      target: { value: 'other' },
    });
    expect(api.list).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByTestId('entityInventoryDocumentFilter'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    expect(api.list.mock.calls[1][1].documentFilter).toBeUndefined();
  });

  it('warns about metrics a source engine could not compute', async () => {
    setup({
      ...response,
      unsupportedMetrics: [
        {
          index: 'metrics-system.*',
          engine: 'FROM',
          column: 'net_rx_bps',
          field: 'system.network.in.bytes',
          agg: 'sum_rate',
        },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    const callout = within(await screen.findByTestId('entityInventoryUnsupportedMetrics'));
    expect(
      callout.getByText('One metric cannot be computed by its source engine')
    ).toBeInTheDocument();
    expect(
      callout.getByText(
        'net_rx_bps (sum_rate of system.network.in.bytes) in metrics-system.* [FROM]'
      )
    ).toBeInTheDocument();
  });

  it('does not send invalid KQL', () => {
    const api = setup();
    fireEvent.change(screen.getByTestId('entityInventoryDocumentFilter'), {
      target: { value: 'environment: (' },
    });
    expect(screen.getByText('Enter a valid KQL document filter.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
    expect(api.list).not.toHaveBeenCalled();
  });
});

const entityResponse: InventoryListResponse = {
  ...response,
  columns: [
    { name: 'entity.id', kind: 'entity_id' },
    { name: 'service.id', kind: 'identity' },
    { name: 'service.name', kind: 'identity' },
    { name: 'service.environment', kind: 'identity' },
    { name: 'latency', kind: 'metric' },
  ],
  rows: [
    {
      'entity.id': 'service:123',
      'service.id': '123',
      'service.name': 'checkout',
      'service.environment': 'prod',
      latency: 5,
    },
  ],
  total: 1,
};

describe('entity detail preview', () => {
  it('queries the first complete identity composition in the original list window and shows detail diagnostics', async () => {
    const api = setup(entityResponse);
    api.detail.mockResolvedValue({
      ...entityResponse,
      columns: [...entityResponse.columns, { name: 'phase', kind: 'attribute' }],
      rows: [{ ...entityResponse.rows[0], latency: null, phase: 'running' }],
      timeSeries: {
        ...timeSeries,
        points: [{ entityId: 'service:123', timestamp: timeSeries.from, metrics: { latency: 42 } }],
      },
      queries: [
        {
          engine: 'FROM',
          index: 'traces-*',
          esql: 'FROM traces-* | WHERE service.id == ?id',
          params: { id: '123' },
        },
      ],
    });
    fireEvent.change(screen.getByTestId('entityInventoryDocumentFilter'), {
      target: { value: 'environment: prod' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await screen.findByTestId('entityInventoryEntityDetailLink');
    fireEvent.click(screen.getByRole('button', { name: '1h' }));
    fireEvent.click(screen.getByTestId('entityInventoryEntityDetailLink'));
    const flyout = within(await screen.findByTestId('entityInventoryEntityDetailFlyout'));
    await flyout.findByText('running');
    expect(flyout.queryByText('latency')).not.toBeInTheDocument();
    expect(EntityMetricCharts).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 'service:123',
        result: expect.objectContaining({
          timeSeries: expect.objectContaining({ targetBuckets: 250 }),
        }),
      }),
      expect.anything()
    );
    const { from, to } = api.list.mock.calls[0][1];
    expect(api.detail).toHaveBeenCalledWith('service', {
      from,
      to,
      identity: { 'service.id': '123' },
    });
    expect(
      flyout.getByText('The detail query does not apply the preview document filter.')
    ).toBeInTheDocument();
    fireEvent.click(flyout.getByText('FROM traces-*'));
    expect(flyout.getByText(/WHERE service.id/)).toBeInTheDocument();
    expect(flyout.getByText(/"id": "123"/)).toBeInTheDocument();
  });

  it.each([null, ''])(
    'uses the complete fallback composition when the preferred field is %p and shows request failures',
    async (preferredValue) => {
      const api = setup({
        ...entityResponse,
        rows: [{ ...entityResponse.rows[0], 'service.id': preferredValue }],
      });
      api.detail.mockRejectedValue({
        body: { message: 'Detail query failed' },
        response: { status: 500 },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Run' }));
      fireEvent.click(await screen.findByTestId('entityInventoryEntityDetailLink'));
      expect(await screen.findByText('[500] Detail query failed')).toBeInTheDocument();
      expect(api.detail).toHaveBeenCalledWith(
        'service',
        expect.objectContaining({
          identity: { 'service.name': 'checkout', 'service.environment': 'prod' },
        })
      );
    }
  );

  it('shows loading, closes without reopening on a late response, and runs a fresh query on the next click', async () => {
    const api = setup(entityResponse);
    let resolveDetail = (value: InventoryDetailResponse) => {};
    const detailPromise = new Promise<InventoryDetailResponse>((resolve) => {
      resolveDetail = resolve;
    });
    api.detail.mockReturnValueOnce(detailPromise);
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    fireEvent.click(await screen.findByTestId('entityInventoryEntityDetailLink'));
    expect(screen.getByLabelText('Loading entity details')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close this dialog' }));
    await act(async () => {
      resolveDetail({ ...entityResponse, timeSeries });
      await detailPromise;
    });
    expect(screen.queryByTestId('entityInventoryEntityDetailFlyout')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('entityInventoryEntityDetailLink'));
    await screen.findByText('Detail queries');
    expect(api.detail).toHaveBeenCalledTimes(2);
  });

  it('does not display a different entity returned by a fallback detail query', async () => {
    const api = setup(entityResponse);
    api.detail.mockResolvedValue({
      ...entityResponse,
      timeSeries,
      rows: [{ 'entity.id': 'service:other', latency: 999 }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    fireEvent.click(await screen.findByTestId('entityInventoryEntityDetailLink'));
    const flyout = within(await screen.findByTestId('entityInventoryEntityDetailFlyout'));
    expect(
      await flyout.findByText('No matching entity was returned for this time window.')
    ).toBeInTheDocument();
    expect(flyout.queryByText('999')).not.toBeInTheDocument();
    expect(flyout.getByText('Detail queries')).toBeInTheDocument();
  });

  it('pages by the default page size after a smaller result set was shown first', async () => {
    const rowsOf = (count: number): InventoryListResponse => ({
      ...entityResponse,
      rows: Array.from({ length: count }, (_, index) => ({
        ...entityResponse.rows[0],
        'entity.id': `service:${index}`,
        'service.id': String(index),
      })),
      total: count,
    });
    const api = setup(rowsOf(20));
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await screen.findByText('service:19');
    api.list.mockResolvedValue(rowsOf(32));
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await screen.findByText('service:24');
    expect(screen.queryByText('service:25')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Page 2 of 2')).toBeInTheDocument();
    expect(screen.queryByLabelText(/of 32/)).not.toBeInTheDocument();
  });

  it('does not coerce multivalued identity fields into detail filters', async () => {
    const api = setup({
      ...entityResponse,
      rows: [{ ...entityResponse.rows[0], 'service.id': ['123', '456'] }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await screen.findByText('service:123');
    expect(screen.queryByTestId('entityInventoryEntityDetailLink')).not.toBeInTheDocument();
    expect(api.detail).not.toHaveBeenCalled();
  });
});
