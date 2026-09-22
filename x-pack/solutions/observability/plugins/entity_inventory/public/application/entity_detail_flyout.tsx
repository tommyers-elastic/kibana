/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useEffect, useState } from 'react';
import {
  EuiAccordion,
  EuiCodeBlock,
  EuiDescriptionList,
  EuiFlyout,
  EuiFlyoutBody,
  EuiFlyoutHeader,
  EuiLoadingSpinner,
  EuiSpacer,
  EuiText,
  EuiTitle,
  useGeneratedHtmlId,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import { KbnDangerCallout, KbnWarningCallout } from '@kbn/ui-callout';
import { ENTITY_ID_COLUMN, type InventoryDetailResponse } from '../../common';
import { formatCellValue } from '../lib/format_cell_value';
import { describeHttpError, type DescribedError } from '../lib/http_error';
import type { InventoryApi, InventoryDetailRequest } from '../lib/inventory_api';
import { EntityAttributes } from './entity_attributes';
import { EntityMetricCharts } from './entity_metric_charts';

export interface EntityDetailSelection {
  entityId: string;
  request: InventoryDetailRequest;
  hasDocumentFilter: boolean;
}

interface EntityDetailFlyoutProps {
  type: string;
  selection: EntityDetailSelection;
  api: InventoryApi;
  onClose: () => void;
}

/** Executes the selected entity's detail query and exposes the response and query diagnostics. */
export const EntityDetailFlyout = ({ type, selection, api, onClose }: EntityDetailFlyoutProps) => {
  const { entityId, request, hasDocumentFilter } = selection;
  const titleId = useGeneratedHtmlId({ prefix: 'entityInventoryEntityDetail' });
  const [result, setResult] = useState<InventoryDetailResponse>();
  const [error, setError] = useState<DescribedError>();

  useEffect(() => {
    let active = true;
    setResult(undefined);
    setError(undefined);
    api.detail(type, request).then(
      (response) => {
        if (active) setResult(response);
      },
      (caught) => {
        if (active) setError(describeHttpError(caught));
      }
    );
    return () => {
      active = false;
    };
  }, [api, type, request]);

  const row = result?.rows.find((candidate) => candidate[ENTITY_ID_COLUMN] === entityId);

  return (
    <EuiFlyout
      ownFocus
      size="m"
      onClose={onClose}
      aria-labelledby={titleId}
      data-test-subj="entityInventoryEntityDetailFlyout"
    >
      <EuiFlyoutHeader hasBorder>
        <EuiTitle size="m">
          <h2 id={titleId}>
            {i18n.translate('xpack.entityInventory.entityDetail.detailsTitle', {
              defaultMessage: 'Entity details',
            })}
          </h2>
        </EuiTitle>
        <EuiText size="s">
          <p>{entityId}</p>
        </EuiText>
      </EuiFlyoutHeader>
      <EuiFlyoutBody>
        <EuiText size="s">
          <p>
            {i18n.translate('xpack.entityInventory.entityDetail.windowDescription', {
              defaultMessage: 'Time window: {from} to {to}',
              values: { from: request.from, to: request.to },
            })}
          </p>
          {hasDocumentFilter && (
            <p>
              {i18n.translate('xpack.entityInventory.entityDetail.documentFilterDescription', {
                defaultMessage: 'The detail query does not apply the preview document filter.',
              })}
            </p>
          )}
        </EuiText>
        <EuiSpacer size="m" />
        {!result && !error && (
          <EuiLoadingSpinner
            aria-label={i18n.translate('xpack.entityInventory.entityDetail.loadingAriaLabel', {
              defaultMessage: 'Loading entity details',
            })}
          />
        )}
        {error && (
          <KbnDangerCallout
            title={i18n.translate('xpack.entityInventory.entityDetail.errorTitle', {
              defaultMessage: 'Could not load entity details',
            })}
          >
            <p>
              {error.statusCode === undefined
                ? error.message
                : `[${error.statusCode}] ${error.message}`}
            </p>
          </KbnDangerCallout>
        )}
        {result && (
          <>
            {result.truncated && (
              <>
                <KbnWarningCallout
                  title={i18n.translate('xpack.entityInventory.entityDetail.truncatedTitle', {
                    defaultMessage: 'Some detail results were truncated',
                  })}
                />
                <EuiSpacer size="m" />
              </>
            )}
            {result.errors.length > 0 && (
              <>
                <KbnWarningCallout
                  title={i18n.translate('xpack.entityInventory.entityDetail.sourceErrorsTitle', {
                    defaultMessage: 'Some detail sources failed',
                  })}
                >
                  <ul>
                    {result.errors.map(({ index, message }, indexNumber) => (
                      <li key={`${index}-${indexNumber}`}>{`${index}: ${message}`}</li>
                    ))}
                  </ul>
                </KbnWarningCallout>
                <EuiSpacer size="m" />
              </>
            )}
            {row ? (
              <>
                <EntityAttributes columns={result.columns} row={row} />
                <EuiSpacer size="l" />
                <EntityMetricCharts entityId={entityId} result={result} />
              </>
            ) : (
              <EuiText size="s">
                <p>
                  {i18n.translate('xpack.entityInventory.entityDetail.noResultDescription', {
                    defaultMessage: 'No matching entity was returned for this time window.',
                  })}
                </p>
              </EuiText>
            )}
            <EuiSpacer size="l" />
            <EuiTitle size="xs">
              <h3>
                {i18n.translate('xpack.entityInventory.entityDetail.queriesTitle', {
                  defaultMessage: 'Detail queries',
                })}
              </h3>
            </EuiTitle>
            <EuiText size="s">
              <p>
                {i18n.translate('xpack.entityInventory.entityDetail.timingsDescription', {
                  defaultMessage: 'Wall time: {wallTime} ms. Cumulative ES took: {esTime} ms.',
                  values: { wallTime: result.tookMs, esTime: result.esTookMs },
                })}
              </p>
            </EuiText>
            {result.queries.map((query, index) => (
              <EuiAccordion
                key={`${query.index}-${index}`}
                id={`${titleId}-query-${index}`}
                buttonContent={`${query.engine} ${query.index}`}
                paddingSize="s"
              >
                <EuiDescriptionList
                  compressed
                  type="inline"
                  listItems={[
                    { title: 'tookMs', description: formatCellValue(query.tookMs) ?? '—' },
                    {
                      title: 'documentsFound',
                      description: formatCellValue(query.documentsFound) ?? '—',
                    },
                    { title: 'rows', description: formatCellValue(query.rows) ?? '—' },
                  ]}
                />
                <EuiCodeBlock language="sql" fontSize="s" paddingSize="s" isCopyable>
                  {query.esql}
                </EuiCodeBlock>
                {query.params && (
                  <EuiCodeBlock language="json" fontSize="s" paddingSize="s" isCopyable>
                    {JSON.stringify(query.params, null, 2)}
                  </EuiCodeBlock>
                )}
              </EuiAccordion>
            ))}
          </>
        )}
      </EuiFlyoutBody>
    </EuiFlyout>
  );
};
