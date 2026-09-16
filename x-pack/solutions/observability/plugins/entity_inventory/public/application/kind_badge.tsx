/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { EuiBadge } from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import type { RecordKind } from '../lib/record_summary';

export const kindLabel: Record<RecordKind, string> = {
  definition: i18n.translate('xpack.entityInventory.kind.definition', {
    defaultMessage: 'Definition',
  }),
  built_in: i18n.translate('xpack.entityInventory.kind.builtIn', {
    defaultMessage: 'Built-in',
  }),
  built_in_extension: i18n.translate('xpack.entityInventory.kind.builtInExtension', {
    defaultMessage: 'Built-in + extension',
  }),
  code: i18n.translate('xpack.entityInventory.kind.code', { defaultMessage: 'Code' }),
};

const kindColor: Record<RecordKind, string> = {
  definition: 'primary',
  built_in: 'hollow',
  built_in_extension: 'success',
  code: 'default',
};

export const KindBadge = ({ kind }: { kind: RecordKind }) => (
  <EuiBadge color={kindColor[kind]}>{kindLabel[kind]}</EuiBadge>
);
