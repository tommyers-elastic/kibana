/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { css } from '@emotion/react';
import { euiFontSize, EuiPanel, EuiSpacer, EuiTitle, useEuiTheme } from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import type { InventoryColumn, InventoryRow } from '../../common';
import { formatCellValue } from '../lib/format_cell_value';

interface EntityAttributesProps {
  columns: InventoryColumn[];
  row: InventoryRow;
}

/** Displays the entity's identity fields and attributes in a compact responsive grid. */
export const EntityAttributes = ({ columns, row }: EntityAttributesProps) => {
  const theme = useEuiTheme();
  const { euiTheme } = theme;
  const attributes = columns.filter(({ kind }) => kind !== 'metric' && kind !== 'entity_id');

  if (attributes.length === 0) return null;

  return (
    <EuiPanel hasBorder hasShadow={false} paddingSize="m">
      <EuiTitle size="xs">
        <h3>
          {i18n.translate('xpack.entityInventory.entityDetail.attributesTitle', {
            defaultMessage: 'Attributes',
          })}
        </h3>
      </EuiTitle>
      <EuiSpacer size="m" />
      <dl
        css={css`
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
          gap: ${euiTheme.size.m} ${euiTheme.size.l};
        `}
      >
        {attributes.map(({ name, kind }) => {
          const value = formatCellValue(row[name]);
          const timestamp =
            kind === 'last_seen' && typeof row[name] === 'string' ? value : undefined;
          const validTimestamp = timestamp !== undefined && Number.isFinite(Date.parse(timestamp));

          return (
            <div
              key={name}
              css={css`
                min-width: 0;
                overflow-wrap: anywhere;
              `}
            >
              <dt
                css={css`
                  color: ${euiTheme.colors.textSubdued};
                  ${euiFontSize(theme, 'xs')}
                  margin-bottom: ${euiTheme.size.xs};
                `}
              >
                {name}
              </dt>
              <dd
                css={css`
                  ${euiFontSize(theme, 's')}
                  margin: 0;
                `}
              >
                {validTimestamp ? (
                  <time dateTime={timestamp} title={timestamp}>
                    {i18n.translate('xpack.entityInventory.entityDetail.lastSeenValueLabel', {
                      defaultMessage: '{timestamp, date, medium}, {timestamp, time, long}',
                      values: { timestamp: new Date(timestamp) },
                    })}
                  </time>
                ) : (
                  value ?? '—'
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </EuiPanel>
  );
};
