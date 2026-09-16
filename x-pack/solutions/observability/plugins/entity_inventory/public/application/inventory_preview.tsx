/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useState } from 'react';
import { css } from '@emotion/react';
import {
  EuiAccordion,
  EuiBasicTable,
  EuiButton,
  EuiButtonGroup,
  EuiCodeBlock,
  EuiDescriptionList,
  EuiFieldNumber,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFormRow,
  EuiSpacer,
  EuiText,
  EuiTitle,
  useGeneratedHtmlId,
  type EuiBasicTableColumn,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import { KbnDangerCallout, KbnInfoCallout } from '@kbn/ui-callout';
import type { InventoryListResponse, InventoryQueryInfo, InventoryRow } from '../../common';
import { ENTITY_INVENTORY_ROUTES, ESQL_MAX_ROWS } from '../../common';
import { formatCellValue } from '../lib/format_cell_value';
import type { InventoryApi } from '../lib/inventory_api';
import { describeHttpError, type DescribedError } from '../lib/http_error';
import { RELATIVE_RANGES, relativeRangeToAbsolute, type RelativeRange } from '../lib/time_range';

interface InventoryPreviewProps {
  type: string;
  isAvailable: boolean;
  api: InventoryApi;
}

const DEFAULT_PREVIEW_LIMIT = 50;

const rangeOptions = RELATIVE_RANGES.map((range) => ({ id: range, label: range }));

const scrollableTable = css`
  overflow-x: auto;
`;

const summaryItems = (result: InventoryListResponse) => [
  { title: 'total', description: result.total === null ? 'null' : String(result.total) },
  { title: 'truncated', description: String(result.truncated) },
  { title: 'tookMs', description: String(result.tookMs) },
  { title: 'esTookMs', description: String(result.esTookMs) },
  {
    title: 'errors',
    description:
      result.errors.length === 0
        ? '-'
        : result.errors
            .map(({ index, statusCode, message }) =>
              statusCode !== undefined
                ? `${index}: [${statusCode}] ${message}`
                : `${index}: ${message}`
            )
            .join('; '),
  },
  {
    title: 'unavailableColumns',
    description:
      result.unavailableColumns.length === 0
        ? '-'
        : result.unavailableColumns
            .map(({ index, column, field }) => `${column} (${field}) in ${index}`)
            .join('; '),
  },
];

const queryItems = (query: InventoryQueryInfo) => [
  { title: 'engine', description: query.engine },
  { title: 'index', description: query.index },
  { title: 'tookMs', description: formatCellValue(query.tookMs) },
  { title: 'documentsFound', description: formatCellValue(query.documentsFound) },
  { title: 'rows', description: formatCellValue(query.rows) },
];

/** Runs the type's `_list` route over a relative window and shows rows, timings and the ES|QL. */
export const InventoryPreview = ({ type, isAvailable, api }: InventoryPreviewProps) => {
  const [range, setRange] = useState<RelativeRange>('15m');
  const [limit, setLimit] = useState<number>(DEFAULT_PREVIEW_LIMIT);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<InventoryListResponse | undefined>();
  const [error, setError] = useState<DescribedError | undefined>();
  const accordionBaseId = useGeneratedHtmlId({ prefix: 'entityInventoryPreviewQuery' });

  const run = async () => {
    setIsRunning(true);
    setError(undefined);
    try {
      const { from, to } = relativeRangeToAbsolute(range);
      setResult(await api.list(type, { from, to, limit }));
    } catch (caught) {
      setError(describeHttpError(caught));
    } finally {
      setIsRunning(false);
    }
  };

  const rowColumns: Array<EuiBasicTableColumn<InventoryRow>> =
    result?.columns.map(({ name }) => ({
      field: name,
      name,
      // Column names contain dots ("entity.id"), so the value is read by key rather than by path.
      render: (_value: unknown, row: InventoryRow) => formatCellValue(row[name]),
    })) ?? [];

  return (
    <>
      <EuiTitle size="xs">
        <h3>
          {i18n.translate('xpack.entityInventory.preview.title', { defaultMessage: 'Preview' })}
        </h3>
      </EuiTitle>
      <EuiSpacer size="s" />

      {!isAvailable ? (
        <KbnInfoCallout
          size="s"
          title={i18n.translate('xpack.entityInventory.preview.unavailable', {
            defaultMessage:
              'No preview: this type is not returned by {route}, so it has no inventory extension.',
            values: { route: `GET ${ENTITY_INVENTORY_ROUTES.TYPES}` },
          })}
        />
      ) : (
        <>
          <EuiFlexGroup alignItems="flexEnd" gutterSize="m" responsive={false}>
            <EuiFlexItem grow={false}>
              <EuiFormRow
                label={i18n.translate('xpack.entityInventory.preview.rangeLabel', {
                  defaultMessage: 'Time range',
                })}
              >
                <EuiButtonGroup
                  legend={i18n.translate('xpack.entityInventory.preview.rangeLegend', {
                    defaultMessage: 'Time range relative to now',
                  })}
                  options={rangeOptions}
                  idSelected={range}
                  onChange={(id) => setRange(id as RelativeRange)}
                  buttonSize="compressed"
                />
              </EuiFormRow>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiFormRow
                label={i18n.translate('xpack.entityInventory.preview.limitLabel', {
                  defaultMessage: 'Limit',
                })}
              >
                <EuiFieldNumber
                  data-test-subj="entityInventoryInventoryPreviewFieldNumber"
                  compressed
                  min={1}
                  max={ESQL_MAX_ROWS}
                  value={limit}
                  onChange={(event) => setLimit(Number(event.target.value))}
                />
              </EuiFormRow>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiButton
                data-test-subj="entityInventoryInventoryPreviewRunButton"
                iconType="play"
                onClick={run}
                isLoading={isRunning}
                size="s"
              >
                {i18n.translate('xpack.entityInventory.preview.runButton', {
                  defaultMessage: 'Run',
                })}
              </EuiButton>
            </EuiFlexItem>
          </EuiFlexGroup>
          <EuiSpacer size="m" />

          {error && (
            <>
              <KbnDangerCallout
                title={i18n.translate('xpack.entityInventory.preview.error', {
                  defaultMessage: 'Preview failed',
                })}
              >
                <p>
                  {error.statusCode !== undefined
                    ? `[${error.statusCode}] ${error.message}`
                    : error.message}
                </p>
              </KbnDangerCallout>
              <EuiSpacer size="m" />
            </>
          )}

          {result && (
            <>
              <EuiDescriptionList
                type="inline"
                compressed
                listItems={summaryItems(result)}
                data-test-subj="entityInventoryPreviewSummary"
              />
              <EuiSpacer size="m" />
              <div css={scrollableTable}>
                <EuiBasicTable
                  tableCaption={i18n.translate('xpack.entityInventory.preview.rowsCaption', {
                    defaultMessage: 'Entities of type {type}',
                    values: { type },
                  })}
                  items={result.rows}
                  columns={rowColumns}
                  tableLayout="auto"
                  noItemsMessage={i18n.translate('xpack.entityInventory.preview.noRows', {
                    defaultMessage: 'No entities in the window',
                  })}
                />
              </div>
              <EuiSpacer size="m" />
              <EuiText size="s">
                <h4>
                  {i18n.translate('xpack.entityInventory.preview.queriesTitle', {
                    defaultMessage: 'Queries',
                  })}
                </h4>
              </EuiText>
              <EuiSpacer size="s" />
              {result.queries.map((query, index) => (
                <EuiAccordion
                  key={`${query.engine}-${query.index}-${index}`}
                  id={`${accordionBaseId}-${index}`}
                  buttonContent={`${query.engine} ${query.index}`}
                  paddingSize="s"
                >
                  <EuiDescriptionList type="inline" compressed listItems={queryItems(query)} />
                  <EuiSpacer size="s" />
                  <EuiCodeBlock language="sql" fontSize="s" paddingSize="s" isCopyable>
                    {query.esql}
                  </EuiCodeBlock>
                </EuiAccordion>
              ))}
            </>
          )}
        </>
      )}
    </>
  );
};
