/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import {
  Axis,
  Chart,
  Fit,
  LineSeries,
  Position,
  ScaleType,
  Settings,
  Tooltip,
  niceTimeFormatter,
} from '@elastic/charts';
import { EuiPanel, EuiSpacer, EuiText, EuiTitle, useEuiTheme } from '@elastic/eui';
import { useElasticChartsTheme } from '@kbn/charts-theme';
import { i18n } from '@kbn/i18n';
import type { InventoryDetailResponse } from '../../common';
import { formatMetricValue } from '../lib/format_metric_value';

interface EntityMetricChartsProps {
  entityId: string;
  result: InventoryDetailResponse;
}

/** Plots metric buckets with Lens-style linear fitting and automatic point visibility. */
export const EntityMetricCharts = ({ entityId, result }: EntityMetricChartsProps) => {
  const baseTheme = useElasticChartsTheme();
  const { euiTheme } = useEuiTheme();
  const { columns, timeSeries } = result;
  const metrics = columns.filter(({ kind }) => kind === 'metric');
  const points = timeSeries.points.filter((point) => point.entityId === entityId);
  const from = Date.parse(timeSeries.from);
  const to = Date.parse(timeSeries.to);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const formatTime = niceTimeFormatter([from, to]);

  if (metrics.length === 0) return null;

  return (
    <>
      <EuiTitle size="xs">
        <h3>
          {i18n.translate('xpack.entityInventory.entityDetail.metricsTitle', {
            defaultMessage: 'Metrics over time',
          })}
        </h3>
      </EuiTitle>
      <EuiSpacer size="m" />
      {metrics.map(({ name, unit }) => {
        const data = points.map(({ timestamp, metrics: values }) => ({
          timestamp: Date.parse(timestamp),
          value: values[name] ?? null,
        }));
        const hasValues = data.some(({ value }) => value !== null);
        const title = name;
        const formatValue = (value: number) => formatMetricValue(value, unit);
        return (
          <React.Fragment key={name}>
            <EuiPanel
              hasBorder
              hasShadow={false}
              paddingSize="m"
              data-test-subj="entityInventoryMetricChart"
            >
              <EuiTitle size="xxs">
                <h4>{title}</h4>
              </EuiTitle>
              {hasValues ? (
                <Chart size={{ height: 210 }}>
                  <Settings
                    baseTheme={baseTheme}
                    theme={{
                      axes: {
                        axisLine: { visible: false },
                        tickLine: { visible: false },
                        tickLabel: { fill: euiTheme.colors.textSubdued },
                        gridLine: { horizontal: { stroke: euiTheme.colors.borderBasePlain } },
                      },
                    }}
                    showLegend={false}
                    locale={i18n.getLocale()}
                    xDomain={{ min: Math.min(from, data[0]?.timestamp ?? from), max: to }}
                    ariaLabel={title}
                  />
                  <Tooltip
                    headerFormatter={({ value }) =>
                      new Date(Number(value)).toLocaleString(i18n.getLocale(), { timeZone })
                    }
                  />
                  <Axis
                    id="time"
                    position={Position.Bottom}
                    tickFormat={formatTime}
                    gridLine={{ visible: false }}
                  />
                  <Axis
                    id="value"
                    position={Position.Left}
                    tickFormat={formatValue}
                    gridLine={{ visible: true }}
                    ticks={4}
                  />
                  <LineSeries
                    id={name}
                    name={title}
                    data={data}
                    xAccessor="timestamp"
                    yAccessors={['value']}
                    xScaleType={ScaleType.Time}
                    yScaleType={ScaleType.Linear}
                    timeZone={timeZone}
                    fit={Fit.Linear}
                    lineSeriesStyle={{
                      point: { visible: 'auto' },
                      fit: { line: { visible: true, opacity: 1, dash: [] } },
                    }}
                  />
                </Chart>
              ) : (
                <EuiText size="s" color="subdued">
                  <p>
                    {i18n.translate('xpack.entityInventory.entityDetail.noMetricDataDescription', {
                      defaultMessage: 'No samples in this time window.',
                    })}
                  </p>
                </EuiText>
              )}
            </EuiPanel>
            <EuiSpacer size="m" />
          </React.Fragment>
        );
      })}
    </>
  );
};
