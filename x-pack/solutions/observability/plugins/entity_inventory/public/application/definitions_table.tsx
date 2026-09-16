/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useMemo } from 'react';
import {
  EuiBadge,
  EuiInMemoryTable,
  EuiLink,
  EuiText,
  EuiTextColor,
  EuiToolTip,
  type EuiBasicTableColumn,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import type { EntityDefinitionRecord } from '@kbn/entity-store/common';
import { getEditability } from '../lib/editable_document';
import {
  describeIdentity,
  getRecordKind,
  getSourceIndices,
  type RecordKind,
} from '../lib/record_summary';
import { KindBadge, kindLabel } from './kind_badge';

interface DefinitionsTableProps {
  records: EntityDefinitionRecord[];
  previewTypes: string[];
  isLoading: boolean;
  onOpen: (type: string) => void;
  onPreview: (type: string) => void;
  onDelete: (record: EntityDefinitionRecord) => void;
}

/** Flat view model so the in-memory table can sort and search on plain fields. */
interface DefinitionRow {
  type: string;
  name: string;
  label?: string;
  identity: string;
  indices: string[];
  kind: RecordKind;
  kindLabel: string;
  isEditable: boolean;
  hasPreview: boolean;
  record: EntityDefinitionRecord;
}

const EMPTY = '—';

const toRow = (record: EntityDefinitionRecord, previewTypes: string[]): DefinitionRow => {
  const kind = getRecordKind(record);
  return {
    type: record.definition.type,
    name: record.definition.name,
    label: record.definition.inventory?.label,
    identity: describeIdentity(record),
    indices: getSourceIndices(record),
    kind,
    kindLabel: kindLabel[kind],
    isEditable: getEditability(record).kind !== 'read_only',
    hasPreview: previewTypes.includes(record.definition.type),
    record,
  };
};

const readOnlyHint = i18n.translate('xpack.entityInventory.table.readOnlyHint', {
  defaultMessage: 'Built-in and code-registered records cannot be changed through the API',
});

export const DefinitionsTable = ({
  records,
  previewTypes,
  isLoading,
  onOpen,
  onPreview,
  onDelete,
}: DefinitionsTableProps) => {
  const rows = useMemo(
    () => records.map((record) => toRow(record, previewTypes)),
    [records, previewTypes]
  );

  const columns: Array<EuiBasicTableColumn<DefinitionRow>> = [
    {
      field: 'type',
      name: i18n.translate('xpack.entityInventory.table.typeColumn', { defaultMessage: 'Type' }),
      sortable: true,
      render: (type: string, row: DefinitionRow) => (
        <div>
          <EuiLink data-test-subj="entityInventoryTypeLink" onClick={() => onOpen(type)}>
            {type}
          </EuiLink>
          <EuiText size="xs" color="subdued">
            {row.name}
          </EuiText>
        </div>
      ),
    },
    {
      field: 'label',
      name: i18n.translate('xpack.entityInventory.table.labelColumn', { defaultMessage: 'Label' }),
      sortable: true,
      render: (label?: string) => label ?? <EuiTextColor color="subdued">{EMPTY}</EuiTextColor>,
    },
    {
      field: 'identity',
      name: i18n.translate('xpack.entityInventory.table.identityColumn', {
        defaultMessage: 'Identity',
      }),
      truncateText: true,
      render: (identity: string) => <span title={identity}>{identity}</span>,
    },
    {
      field: 'indices',
      name: i18n.translate('xpack.entityInventory.table.sourcesColumn', {
        defaultMessage: 'Data sources',
      }),
      width: '120px',
      align: 'center',
      render: (indices: string[]) =>
        indices.length === 0 ? (
          <EuiTextColor color="subdued">{EMPTY}</EuiTextColor>
        ) : (
          <EuiToolTip
            position="left"
            content={
              <ul>
                {indices.map((index) => (
                  <li key={index}>{index}</li>
                ))}
              </ul>
            }
          >
            <EuiBadge color="hollow" tabIndex={0}>
              {indices.length}
            </EuiBadge>
          </EuiToolTip>
        ),
    },
    {
      field: 'kindLabel',
      name: i18n.translate('xpack.entityInventory.table.kindColumn', { defaultMessage: 'Kind' }),
      width: '180px',
      sortable: true,
      render: (_label: string, row: DefinitionRow) => <KindBadge kind={row.kind} />,
    },
    {
      name: i18n.translate('xpack.entityInventory.table.actionsColumn', {
        defaultMessage: 'Actions',
      }),
      width: '110px',
      actions: [
        {
          name: i18n.translate('xpack.entityInventory.table.editAction', {
            defaultMessage: 'Edit',
          }),
          description: (row: DefinitionRow) =>
            row.isEditable
              ? i18n.translate('xpack.entityInventory.table.editDescription', {
                  defaultMessage: 'Edit {type}',
                  values: { type: row.type },
                })
              : readOnlyHint,
          type: 'icon',
          icon: 'pencil',
          enabled: (row: DefinitionRow) => row.isEditable,
          onClick: (row: DefinitionRow) => onOpen(row.type),
          'data-test-subj': 'entityInventoryEditAction',
        },
        {
          name: i18n.translate('xpack.entityInventory.table.previewAction', {
            defaultMessage: 'Preview',
          }),
          description: (row: DefinitionRow) =>
            row.hasPreview
              ? i18n.translate('xpack.entityInventory.table.previewDescription', {
                  defaultMessage: 'Preview the {type} inventory',
                  values: { type: row.type },
                })
              : i18n.translate('xpack.entityInventory.table.noPreviewHint', {
                  defaultMessage: 'No inventory extension, nothing to preview',
                }),
          type: 'icon',
          icon: 'play',
          enabled: (row: DefinitionRow) => row.hasPreview,
          onClick: (row: DefinitionRow) => onPreview(row.type),
          'data-test-subj': 'entityInventoryPreviewAction',
        },
        {
          name: i18n.translate('xpack.entityInventory.table.deleteAction', {
            defaultMessage: 'Delete',
          }),
          description: (row: DefinitionRow) =>
            row.isEditable
              ? i18n.translate('xpack.entityInventory.table.deleteDescription', {
                  defaultMessage: 'Delete {type}',
                  values: { type: row.type },
                })
              : readOnlyHint,
          type: 'icon',
          icon: 'trash',
          color: 'danger',
          enabled: (row: DefinitionRow) => row.isEditable,
          onClick: (row: DefinitionRow) => onDelete(row.record),
          'data-test-subj': 'entityInventoryDeleteAction',
        },
      ],
    },
  ];

  return (
    <EuiInMemoryTable
      tableCaption={i18n.translate('xpack.entityInventory.table.caption', {
        defaultMessage: 'Entity definitions in this space',
      })}
      items={rows}
      itemId="type"
      columns={columns}
      loading={isLoading}
      tableLayout="auto"
      sorting={{ sort: { field: 'type', direction: 'asc' } }}
      search={{
        box: {
          incremental: true,
          placeholder: i18n.translate('xpack.entityInventory.table.searchPlaceholder', {
            defaultMessage: 'Search by type, name or label',
          }),
        },
      }}
      rowProps={(row) => ({ onClick: () => onOpen(row.type) })}
      noItemsMessage={i18n.translate('xpack.entityInventory.table.empty', {
        defaultMessage: 'No entity definitions',
      })}
    />
  );
};
