/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useMemo, useState } from 'react';
import { css } from '@emotion/react';
import {
  EuiAccordion,
  EuiButton,
  EuiButtonGroup,
  EuiCode,
  EuiCodeBlock,
  EuiDescriptionList,
  EuiFieldNumber,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFormRow,
  EuiInMemoryTable,
  EuiSpacer,
  EuiStat,
  EuiText,
  EuiTextColor,
  EuiTitle,
  EuiToolTip,
  useGeneratedHtmlId,
  type EuiBasicTableColumn,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import { KbnDangerCallout, KbnInfoCallout, KbnWarningCallout } from '@kbn/ui-callout';
import type {
  InventoryColumn,
  InventoryColumnKind,
  InventoryListResponse,
  InventoryQueryInfo,
} from '../../common';
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

/** ES|QL numeric types; metric columns are numeric by construction. */
const NUMERIC_ES_TYPES = new Set([
  'long',
  'integer',
  'short',
  'byte',
  'double',
  'float',
  'half_float',
  'scaled_float',
  'unsigned_long',
  'counter_long',
  'counter_integer',
  'counter_double',
]);

const isNumericColumn = ({ kind, esType }: InventoryColumn): boolean =>
  kind === 'metric' || (esType !== undefined && NUMERIC_ES_TYPES.has(esType));

const EMPTY_CELL = '—';

const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

/** Wide row sets scroll horizontally; pagination bounds the height. */
const scrollableTable = css`
  overflow-x: auto;
`;

const kindHint: Record<InventoryColumnKind, string> = {
  entity_id: i18n.translate('xpack.entityInventory.preview.columnKind.entityId', {
    defaultMessage: 'id',
  }),
  identity: i18n.translate('xpack.entityInventory.preview.columnKind.identity', {
    defaultMessage: 'identity',
  }),
  attribute: i18n.translate('xpack.entityInventory.preview.columnKind.attribute', {
    defaultMessage: 'attribute',
  }),
  metric: i18n.translate('xpack.entityInventory.preview.columnKind.metric', {
    defaultMessage: 'metric',
  }),
  last_seen: i18n.translate('xpack.entityInventory.preview.columnKind.lastSeen', {
    defaultMessage: 'timestamp',
  }),
};

/**
 * Table view model: values by column position (column names contain dots, which the table would
 * read as paths) plus one string the search box matches against.
 */
interface PreviewRow {
  id: string;
  values: unknown[];
  searchText: string;
}

const toPreviewRows = ({ columns, rows }: InventoryListResponse): PreviewRow[] =>
  rows.map((row, index) => {
    const values = columns.map(({ name }) => row[name]);
    return {
      id: String(index),
      values,
      searchText: values
        .map((value) => formatCellValue(value))
        .filter((text): text is string => text !== undefined)
        .join(' '),
    };
  });

/** Sort key per column: numbers for numeric columns, epoch millis for last_seen, text otherwise. */
const sortKey = (value: unknown, column: InventoryColumn): number | string => {
  if (column.kind === 'last_seen') {
    const millis = Date.parse(String(value ?? ''));
    return Number.isNaN(millis) ? Number.NEGATIVE_INFINITY : millis;
  }
  if (isNumericColumn(column)) {
    return typeof value === 'number' ? value : Number.NEGATIVE_INFINITY;
  }
  return formatCellValue(value) ?? '';
};

const columnHeader = (column: InventoryColumn) => {
  const details = [
    kindHint[column.kind],
    ...(column.fields !== undefined && column.fields.length > 0 ? [column.fields.join(', ')] : []),
    ...(column.esType !== undefined ? [column.esType] : []),
  ].join(' · ');
  return (
    <EuiToolTip content={details}>
      <div tabIndex={0}>
        <span>{column.name}</span>
        <EuiText size="xs" color="subdued">
          {kindHint[column.kind]}
        </EuiText>
      </div>
    </EuiToolTip>
  );
};

const renderCell = (value: unknown, column: InventoryColumn) => {
  if (value === null || value === undefined) {
    return <EuiTextColor color="subdued">{EMPTY_CELL}</EuiTextColor>;
  }
  if (column.kind === 'entity_id') {
    const id = String(value);
    return <EuiCode title={id}>{id}</EuiCode>;
  }
  if (column.kind === 'last_seen') {
    const iso = String(value);
    const millis = Date.parse(iso);
    return (
      <span title={iso}>{Number.isNaN(millis) ? iso : new Date(millis).toLocaleString()}</span>
    );
  }
  const text = formatCellValue(value) ?? EMPTY_CELL;
  return <span title={text}>{text}</span>;
};

const toTableColumns = (columns: InventoryColumn[]): Array<EuiBasicTableColumn<PreviewRow>> =>
  columns.map((column, index) => ({
    field: `values.${index}`,
    name: columnHeader(column),
    truncateText: true,
    align: isNumericColumn(column) ? 'right' : 'left',
    sortable: (row: PreviewRow) => sortKey(row.values[index], column),
    render: (_value: unknown, row: PreviewRow) => renderCell(row.values[index], column),
  }));

/** The longest single ES `took`: the Elasticsearch share of the wall time, since queries run concurrently. */
const slowestQueryMs = (result: InventoryListResponse): number | undefined => {
  const tooks = result.queries
    .map(({ tookMs }) => tookMs)
    .filter((t): t is number => t !== undefined);
  return tooks.length > 0 ? Math.max(...tooks) : undefined;
};

const yesNo = (value: boolean): string =>
  value
    ? i18n.translate('xpack.entityInventory.preview.yes', { defaultMessage: 'yes' })
    : i18n.translate('xpack.entityInventory.preview.no', { defaultMessage: 'no' });

const queryItems = (query: InventoryQueryInfo) => [
  { title: 'engine', description: query.engine },
  { title: 'index', description: query.index },
  { title: 'tookMs', description: formatCellValue(query.tookMs) ?? EMPTY_CELL },
  { title: 'documentsFound', description: formatCellValue(query.documentsFound) ?? EMPTY_CELL },
  { title: 'rows', description: formatCellValue(query.rows) ?? EMPTY_CELL },
];

/** Runs the type's `_list` route over a relative window and shows rows, timings and the ES|QL. */
export const InventoryPreview = ({ type, isAvailable, api }: InventoryPreviewProps) => {
  const [range, setRange] = useState<RelativeRange>('15m');
  const [limit, setLimit] = useState<number>(DEFAULT_PREVIEW_LIMIT);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<InventoryListResponse | undefined>();
  const [error, setError] = useState<DescribedError | undefined>();
  const accordionBaseId = useGeneratedHtmlId({ prefix: 'entityInventoryPreviewQuery' });

  // Columns arrive ordered by the route (entity.id first, last_seen last) and are kept as-is.
  const tableColumns = useMemo(
    () => (result === undefined ? [] : toTableColumns(result.columns)),
    [result]
  );
  const tableRows = useMemo(() => (result === undefined ? [] : toPreviewRows(result)), [result]);

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

  if (!isAvailable) {
    return (
      <KbnInfoCallout
        title={i18n.translate('xpack.entityInventory.preview.unavailableTitle', {
          defaultMessage: 'No inventory preview for this type',
        })}
      >
        <p>
          {i18n.translate('xpack.entityInventory.preview.unavailable', {
            defaultMessage:
              'The type is not returned by {route}: it has no inventory extension, so there are no sources to query.',
            values: { route: `GET ${ENTITY_INVENTORY_ROUTES.TYPES}` },
          })}
        </p>
      </KbnInfoCallout>
    );
  }

  return (
    <>
      <EuiFlexGroup alignItems="flexEnd" gutterSize="m" responsive={false}>
        <EuiFlexItem grow={false}>
          <EuiFormRow
            label={i18n.translate('xpack.entityInventory.preview.rangeLabel', {
              defaultMessage: 'Window',
            })}
          >
            <EuiButtonGroup
              legend={i18n.translate('xpack.entityInventory.preview.rangeLegend', {
                defaultMessage: 'Time window relative to now',
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
          <EuiFormRow hasEmptyLabelSpace>
            <EuiButton
              data-test-subj="entityInventoryInventoryPreviewRunButton"
              fill
              iconType="play"
              onClick={run}
              isLoading={isRunning}
              size="s"
            >
              {i18n.translate('xpack.entityInventory.preview.runButton', {
                defaultMessage: 'Run',
              })}
            </EuiButton>
          </EuiFormRow>
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="l" />

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
          <EuiSpacer size="l" />
        </>
      )}

      {result && (
        <>
          <EuiFlexGroup
            gutterSize="l"
            responsive={false}
            data-test-subj="entityInventoryPreviewSummary"
          >
            <EuiFlexItem>
              <EuiStat
                titleSize="s"
                title={result.total === null ? EMPTY_CELL : formatCellValue(result.total)}
                description={i18n.translate('xpack.entityInventory.preview.stat.total', {
                  defaultMessage: 'Total entities',
                })}
              />
            </EuiFlexItem>
            <EuiFlexItem>
              <EuiStat
                titleSize="s"
                title={formatCellValue(result.rows.length)}
                description={i18n.translate('xpack.entityInventory.preview.stat.rows', {
                  defaultMessage: 'Rows returned',
                })}
              />
            </EuiFlexItem>
            <EuiFlexItem>
              <EuiStat
                titleSize="s"
                title={yesNo(result.truncated)}
                titleColor={result.truncated ? 'warning' : 'default'}
                description={i18n.translate('xpack.entityInventory.preview.stat.truncated', {
                  defaultMessage: 'Truncated',
                })}
              />
            </EuiFlexItem>
            <EuiFlexItem>
              <EuiStat
                titleSize="s"
                title={formatCellValue(result.tookMs)}
                description={i18n.translate('xpack.entityInventory.preview.stat.took', {
                  defaultMessage: 'Wall time (ms)',
                })}
              />
            </EuiFlexItem>
            <EuiFlexItem>
              <EuiStat
                titleSize="s"
                title={formatCellValue(slowestQueryMs(result))}
                description={i18n.translate('xpack.entityInventory.preview.stat.slowestQuery', {
                  defaultMessage: 'Slowest query, ES took (ms)',
                })}
              />
            </EuiFlexItem>
            <EuiFlexItem>
              <EuiStat
                titleSize="s"
                title={formatCellValue(result.esTookMs)}
                description={i18n.translate('xpack.entityInventory.preview.stat.esTook', {
                  defaultMessage: 'Cumulative ES took (ms)',
                })}
              />
            </EuiFlexItem>
          </EuiFlexGroup>
          <EuiSpacer size="s" />
          <EuiText size="xs" color="subdued">
            {i18n.translate('xpack.entityInventory.preview.timingsHint', {
              defaultMessage:
                'The {count} queries run concurrently: wall time is what the request waited for, cumulative ES took is the sum of Elasticsearch work across all of them.',
              values: { count: result.queries.length },
            })}
          </EuiText>
          <EuiSpacer size="l" />

          {result.errors.length > 0 && (
            <>
              <KbnWarningCallout
                size="s"
                title={i18n.translate('xpack.entityInventory.preview.sourceErrors', {
                  defaultMessage:
                    '{count, plural, one {One source failed} other {# sources failed}}',
                  values: { count: result.errors.length },
                })}
              >
                <ul>
                  {result.errors.map(({ index, statusCode, message }) => (
                    <li key={index}>
                      {statusCode !== undefined
                        ? `${index}: [${statusCode}] ${message}`
                        : `${index}: ${message}`}
                    </li>
                  ))}
                </ul>
              </KbnWarningCallout>
              <EuiSpacer size="m" />
            </>
          )}

          {result.unavailableColumns.length > 0 && (
            <>
              <KbnWarningCallout
                size="s"
                title={i18n.translate('xpack.entityInventory.preview.unavailableColumns', {
                  defaultMessage:
                    '{count, plural, one {One column is unmapped in a source} other {# columns are unmapped in their source}}',
                  values: { count: result.unavailableColumns.length },
                })}
              >
                <ul>
                  {result.unavailableColumns.map(({ index, column, field }) => (
                    <li key={`${index}:${column}`}>{`${column} (${field}) in ${index}`}</li>
                  ))}
                </ul>
              </KbnWarningCallout>
              <EuiSpacer size="m" />
            </>
          )}

          <EuiText size="xs" color="subdued">
            <p>
              {i18n.translate('xpack.entityInventory.preview.rowsSummary', {
                defaultMessage: '{rows} of {total} rows, truncated: {truncated}',
                values: {
                  rows: result.rows.length,
                  total: result.total === null ? '?' : result.total,
                  truncated: yesNo(result.truncated),
                },
              })}
            </p>
          </EuiText>
          <EuiSpacer size="xs" />
          <div css={scrollableTable}>
            <EuiInMemoryTable
              tableCaption={i18n.translate('xpack.entityInventory.preview.rowsCaption', {
                defaultMessage: 'Entities of type {type}',
                values: { type },
              })}
              items={tableRows}
              itemId="id"
              columns={tableColumns}
              tableLayout="auto"
              responsiveBreakpoint={false}
              sorting={true}
              search={{
                box: {
                  incremental: true,
                  placeholder: i18n.translate('xpack.entityInventory.preview.searchPlaceholder', {
                    defaultMessage: 'Filter the returned rows',
                  }),
                },
              }}
              executeQueryOptions={{ defaultFields: ['searchText'] }}
              pagination={
                tableRows.length > DEFAULT_PAGE_SIZE
                  ? { initialPageSize: DEFAULT_PAGE_SIZE, pageSizeOptions: PAGE_SIZE_OPTIONS }
                  : false
              }
              noItemsMessage={i18n.translate('xpack.entityInventory.preview.noRows', {
                defaultMessage: 'No entities in the window',
              })}
            />
          </div>
          <EuiSpacer size="l" />

          <EuiTitle size="xs">
            <h3>
              {i18n.translate('xpack.entityInventory.preview.queriesTitle', {
                defaultMessage: 'Queries',
              })}
            </h3>
          </EuiTitle>
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
  );
};
