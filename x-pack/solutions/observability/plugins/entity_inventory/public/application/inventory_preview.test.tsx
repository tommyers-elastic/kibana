/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EuiProvider } from '@elastic/eui';
import type { InventoryApi } from '../lib/inventory_api';
import type { InventoryListResponse } from '../../common';
import { InventoryPreview } from './inventory_preview';

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

const setup = () => {
  const api = {
    list: jest
      .fn<ReturnType<InventoryApi['list']>, Parameters<InventoryApi['list']>>()
      .mockResolvedValue(response),
    types: jest.fn(),
    documentCounts: jest.fn().mockResolvedValue({ type: 'service', from: '', to: '', counts: [] }),
  };
  render(
    <EuiProvider>
      <InventoryPreview type="service" isAvailable api={api} />
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
