/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useMemo, useRef, useState } from 'react';
import { css } from '@emotion/react';
import {
  EuiAccordion,
  EuiButton,
  EuiButtonGroup,
  EuiCode,
  EuiCodeBlock,
  EuiDescriptionList,
  EuiFieldNumber,
  EuiFieldText,
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
import { fromKueryExpression, toElasticsearchQuery } from '@kbn/es-query';
import { KbnDangerCallout, KbnInfoCallout, KbnWarningCallout } from '@kbn/ui-callout';
import type {
  InventoryColumn,
  InventoryColumnKind,
  InventoryDocumentCount,
  InventoryDocumentCountsResponse,
  InventoryListResponse,
  InventoryQueryInfo,
} from '../../common';
import { ENTITY_INVENTORY_ROUTES, ESQL_MAX_ROWS } from '../../common';
import {
  documentShare,
  formatPercent,
  sumDocumentsInWindow,
  sumProcessedDocuments,
} from '../lib/document_stats';
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

const UNKNOWN = '?';

/** Per-query facts; source queries also get their pattern's in-window count and share when known. */
const queryItems = (query: InventoryQueryInfo, count?: InventoryDocumentCount) => {
  const items = [
    { title: 'engine', description: query.engine },
    { title: 'index', description: query.index },
    { title: 'tookMs', description: formatCellValue(query.tookMs) ?? EMPTY_CELL },
    { title: 'documentsFound', description: formatCellValue(query.documentsFound) ?? EMPTY_CELL },
  ];
  if (query.engine !== 'COUNT') {
    const inWindow =
      count === undefined || count.documentsInWindow === null ? undefined : count.documentsInWindow;
    items.push(
      {
        title: 'documentsInWindow',
        description:
          count === undefined
            ? EMPTY_CELL
            : count.error !== undefined
            ? `${UNKNOWN} (${count.error})`
            : formatCellValue(inWindow) ?? UNKNOWN,
      },
      {
        title: 'share',
        description: formatPercent(documentShare(query.documentsFound, inWindow)) ?? EMPTY_CELL,
      }
    );
  }
  items.push({ title: 'rows', description: formatCellValue(query.rows) ?? EMPTY_CELL });
  return items;
};

/** Runs the type's `_list` route over a relative window and shows rows, timings and the ES|QL. */
export const InventoryPreview = ({ type, isAvailable, api }: InventoryPreviewProps) => {
  const [range, setRange] = useState<RelativeRange>('15m');
  const [limit, setLimit] = useState<number>(DEFAULT_PREVIEW_LIMIT);
  const [documentFilterText, setDocumentFilterText] = useState('');
  const documentFilterInput = useMemo(() => {
    try {
      return {
        filter: documentFilterText.trim()
          ? toElasticsearchQuery(fromKueryExpression(documentFilterText))
          : undefined,
      };
    } catch {
      return {
        error: i18n.translate('xpack.entityInventory.preview.documentFilterErrorMessage', {
          defaultMessage: 'Enter a valid KQL document filter.',
        }),
      };
    }
  }, [documentFilterText]);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<InventoryListResponse | undefined>();
  const [error, setError] = useState<DescribedError | undefined>();
  const [documentCounts, setDocumentCounts] = useState<
    InventoryDocumentCountsResponse | undefined
  >();
  const [documentCountsError, setDocumentCountsError] = useState<DescribedError | undefined>();
  const [isCountingDocuments, setIsCountingDocuments] = useState(false);
  // Identifies the latest run so a slow document count from an earlier run is ignored.
  const runIdRef = useRef(0);
  const accordionBaseId = useGeneratedHtmlId({ prefix: 'entityInventoryPreviewQuery' });

  // Columns arrive ordered by the route (entity.id first, last_seen last) and are kept as-is.
  const tableColumns = useMemo(
    () => (result === undefined ? [] : toTableColumns(result.columns)),
    [result]
  );
  const tableRows = useMemo(() => (result === undefined ? [] : toPreviewRows(result)), [result]);

  const run = async () => {
    if (documentFilterInput.error) return;
    const runId = ++runIdRef.current;
    const isCurrent = () => runId === runIdRef.current;
    const { from, to } = relativeRangeToAbsolute(range);

    setIsRunning(true);
    setError(undefined);
    setDocumentCounts(undefined);
    setDocumentCountsError(undefined);
    setIsCountingDocuments(true);

    // The document count is a separate request so it never delays the rows or enters the timings.
    api
      .documentCounts(type, { from, to })
      .then((counts) => {
        if (isCurrent()) {
          setDocumentCounts(counts);
        }
      })
      .catch((caught) => {
        if (isCurrent()) {
          setDocumentCountsError(describeHttpError(caught));
        }
      })
      .finally(() => {
        if (isCurrent()) {
          setIsCountingDocuments(false);
        }
      });

    try {
      const listResult = await api.list(type, {
        from,
        to,
        limit,
        documentFilter: documentFilterInput.filter,
      });
      if (isCurrent()) {
        setResult(listResult);
      }
    } catch (caught) {
      if (isCurrent()) {
        setError(describeHttpError(caught));
      }
    } finally {
      if (isCurrent()) {
        setIsRunning(false);
      }
    }
  };

  const inWindow =
    documentCounts === undefined ? undefined : sumDocumentsInWindow(documentCounts.counts);
  const processed = result === undefined ? undefined : sumProcessedDocuments(result.queries);
  const share = documentShare(processed, inWindow?.total);
  const countByIndex = new Map(documentCounts?.counts.map((count) => [count.index, count]) ?? []);
  const inWindowProblems = [
    ...(inWindow?.errors ?? []),
    ...(documentCountsError !== undefined
      ? [
          documentCountsError.statusCode !== undefined
            ? `[${documentCountsError.statusCode}] ${documentCountsError.message}`
            : documentCountsError.message,
        ]
      : []),
  ];

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
              isDisabled={Boolean(documentFilterInput.error)}
              size="s"
            >
              {i18n.translate('xpack.entityInventory.preview.runButton', {
                defaultMessage: 'Run',
              })}
            </EuiButton>
          </EuiFormRow>
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="m" />
      <EuiFormRow
        fullWidth
        label={i18n.translate('xpack.entityInventory.preview.documentFilterLabel', {
          defaultMessage: 'Document filter (KQL)',
        })}
        helpText={i18n.translate('xpack.entityInventory.preview.documentFilterDescription', {
          defaultMessage:
            'Optional. Filters source documents before aggregation, changing which entities, attributes and metrics contribute. Use source field names.',
        })}
        isInvalid={Boolean(documentFilterInput.error)}
        error={documentFilterInput.error}
      >
        <EuiFieldText
          fullWidth
          data-test-subj="entityInventoryDocumentFilter"
          value={documentFilterText}
          isInvalid={Boolean(documentFilterInput.error)}
          onChange={(event) => setDocumentFilterText(event.target.value)}
          placeholder={i18n.translate('xpack.entityInventory.preview.documentFilterPlaceholder', {
            defaultMessage: 'environment: prod',
          })}
        />
      </EuiFormRow>
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

          <EuiFlexGroup
            gutterSize="l"
            responsive={false}
            data-test-subj="entityInventoryPreviewDocuments"
          >
            <EuiFlexItem>
              <EuiStat
                titleSize="s"
                isLoading={isCountingDocuments}
                title={
                  inWindow?.total !== undefined ? (
                    formatCellValue(inWindow.total)
                  ) : inWindowProblems.length > 0 ? (
                    <EuiToolTip
                      content={
                        <ul>
                          {inWindowProblems.map((problem) => (
                            <li key={problem}>{problem}</li>
                          ))}
                        </ul>
                      }
                    >
                      <span tabIndex={0}>{UNKNOWN}</span>
                    </EuiToolTip>
                  ) : (
                    EMPTY_CELL
                  )
                }
                description={i18n.translate(
                  'xpack.entityInventory.preview.stat.documentsInWindow',
                  {
                    defaultMessage: 'Documents in window',
                  }
                )}
              />
            </EuiFlexItem>
            <EuiFlexItem>
              <EuiStat
                titleSize="s"
                title={formatCellValue(processed) ?? EMPTY_CELL}
                description={i18n.translate(
                  'xpack.entityInventory.preview.stat.documentsProcessed',
                  {
                    defaultMessage: 'Reads by queries',
                  }
                )}
              />
            </EuiFlexItem>
            <EuiFlexItem>
              <EuiStat
                titleSize="s"
                isLoading={isCountingDocuments}
                title={formatPercent(share) ?? (inWindowProblems.length > 0 ? UNKNOWN : EMPTY_CELL)}
                description={i18n.translate('xpack.entityInventory.preview.stat.documentsShare', {
                  defaultMessage: 'Share',
                })}
              />
            </EuiFlexItem>
          </EuiFlexGroup>
          <EuiSpacer size="s" />
          <EuiText size="xs" color="subdued">
            {i18n.translate('xpack.entityInventory.preview.documentsHint', {
              defaultMessage:
                'Reads is the sum of what each source query read after pushing filters down (under TS only documents carrying the declared metrics); sources that share an index pattern read the same documents again, so reads can exceed the documents in window. In window counts every document of the distinct source patterns in the range once, by a separate query that is not included in the timings.',
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

          {(result.documentFilterWarnings?.length ?? 0) > 0 && (
            <>
              <KbnWarningCallout
                size="s"
                data-test-subj="entityInventoryDocumentFilterWarnings"
                title={i18n.translate('xpack.entityInventory.preview.documentFilterWarningsTitle', {
                  defaultMessage: 'Document filter excludes some data sources',
                })}
              >
                <ul>
                  {result.documentFilterWarnings?.map((warning, index) => (
                    <li key={`${warning.sourcePatterns.join(',')}-${index}`}>
                      {warning.code === 'source_excluded'
                        ? i18n.translate(
                            'xpack.entityInventory.preview.documentFilterSourceDescription',
                            {
                              defaultMessage:
                                '{source}: the filter cannot match any index with a complete identity because required fields are unmapped: {fields}.',
                              values: {
                                source: warning.sourcePatterns.join(', '),
                                fields: warning.fields.join(', '),
                              },
                            }
                          )
                        : i18n.translate(
                            'xpack.entityInventory.preview.documentFilterIndicesDescription',
                            {
                              defaultMessage:
                                '{source}: the filter cannot match {excluded} of {total} indices with a complete identity because required fields are unmapped: {fields}.',
                              values: {
                                source: warning.sourcePatterns.join(', '),
                                excluded: warning.excludedIndices.length,
                                total: warning.eligibleIndexCount,
                                fields: warning.fields.join(', '),
                              },
                            }
                          )}
                      {warning.columns.length > 0 && (
                        <p>
                          {i18n.translate(
                            'xpack.entityInventory.preview.documentFilterColumnsDescription',
                            {
                              defaultMessage:
                                'Attributes and metrics that may be affected: {columns}.',
                              values: { columns: warning.columns.join(', ') },
                            }
                          )}
                        </p>
                      )}
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
              <EuiDescriptionList
                type="inline"
                compressed
                listItems={queryItems(query, countByIndex.get(query.index))}
              />
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
