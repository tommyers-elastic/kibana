/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { EuiProvider } from '@elastic/eui';
import { EntityAttributes } from './entity_attributes';

describe('EntityAttributes', () => {
  it('retains identity and attribute values, including missing, falsy, and structured values', () => {
    render(
      <EuiProvider>
        <EntityAttributes
          columns={[
            { name: 'entity.id', kind: 'entity_id' },
            { name: 'host.id', kind: 'identity' },
            { name: 'attempts', kind: 'attribute' },
            { name: 'active', kind: 'attribute' },
            { name: 'labels', kind: 'attribute' },
            { name: 'zone', kind: 'attribute' },
            { name: 'cpu', kind: 'metric' },
          ]}
          row={{
            'entity.id': 'host:123',
            'host.id': '123',
            attempts: 0,
            active: false,
            labels: ['production', 'checkout'],
            zone: null,
            cpu: 50,
          }}
        />
      </EuiProvider>
    );

    expect(screen.getByRole('heading', { name: 'Attributes' })).toBeInTheDocument();
    expect(screen.getAllByRole('term').map(({ textContent }) => textContent)).toEqual([
      'host.id',
      'attempts',
      'active',
      'labels',
      'zone',
    ]);
    expect(screen.getAllByRole('definition').map(({ textContent }) => textContent)).toEqual([
      '123',
      '0',
      'false',
      '["production","checkout"]',
      '—',
    ]);
  });

  it('formats last seen while preserving the exact timestamp', () => {
    const timestamp = '2026-09-22T14:35:20.123Z';
    render(
      <EuiProvider>
        <EntityAttributes
          columns={[{ name: 'last_seen', kind: 'last_seen' }]}
          row={{ last_seen: timestamp }}
        />
      </EuiProvider>
    );

    const lastSeen = screen.getByTitle(timestamp);
    expect(lastSeen.tagName).toBe('TIME');
    expect(lastSeen).toHaveAttribute('datetime', timestamp);
    expect(lastSeen).toHaveTextContent('2026');
    expect(lastSeen.textContent).not.toBe(timestamp);
  });

  it('preserves an unrecognized last seen value', () => {
    render(
      <EuiProvider>
        <EntityAttributes
          columns={[{ name: 'last_seen', kind: 'last_seen' }]}
          row={{ last_seen: 'unrecognized timestamp' }}
        />
      </EuiProvider>
    );

    expect(screen.getByRole('definition')).toHaveTextContent('unrecognized timestamp');
  });
});
