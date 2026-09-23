/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { i18n } from '@kbn/i18n';
import { KbnWarningCallout } from '@kbn/ui-callout';
import type { InventoryUnsupportedMetric } from '../../common';

interface UnsupportedMetricsCalloutProps {
  metrics: InventoryUnsupportedMetric[];
}

/** Lists the metrics a source's engine could not compute, which are null in that source's rows. */
export const UnsupportedMetricsCallout = ({ metrics }: UnsupportedMetricsCalloutProps) => (
  <KbnWarningCallout
    size="s"
    data-test-subj="entityInventoryUnsupportedMetrics"
    title={i18n.translate('xpack.entityInventory.unsupportedMetrics.title', {
      defaultMessage:
        '{count, plural, one {One metric cannot be computed by its source engine} other {# metrics cannot be computed by their source engine}}',
      values: { count: metrics.length },
    })}
  >
    <p>
      {i18n.translate('xpack.entityInventory.unsupportedMetrics.description', {
        defaultMessage:
          'Counter rates need the TS engine, which requires every index behind the pattern to be time_series. These metrics were left out of the query and are null for that source.',
      })}
    </p>
    <ul>
      {metrics.map(({ index, engine, column, field, agg }) => (
        <li
          key={`${index}:${column}`}
        >{`${column} (${agg} of ${field}) in ${index} [${engine}]`}</li>
      ))}
    </ul>
  </KbnWarningCallout>
);
