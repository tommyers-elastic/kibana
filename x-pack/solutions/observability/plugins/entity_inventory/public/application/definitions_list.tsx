/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { EuiBadge, EuiBasicTable, EuiIcon, EuiLink, type EuiBasicTableColumn } from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import type { EntityDefinitionRecord } from '@kbn/entity-store/common';
import { countSources } from '../lib/editable_document';

interface DefinitionsListProps {
  records: EntityDefinitionRecord[];
  selectedType?: string;
  isLoading: boolean;
  onSelect: (type: string) => void;
}

const sourceColor: Record<EntityDefinitionRecord['source'], string> = {
  built_in: 'hollow',
  code: 'default',
  api: 'primary',
};

export const DefinitionsList = ({
  records,
  selectedType,
  isLoading,
  onSelect,
}: DefinitionsListProps) => {
  const columns: Array<EuiBasicTableColumn<EntityDefinitionRecord>> = [
    {
      field: 'definition.type',
      name: '',
      width: '32px',
      render: (_value: unknown, record: EntityDefinitionRecord) =>
        record.definition.type === selectedType ? (
          <EuiIcon type="check" aria-hidden={true} />
        ) : null,
    },
    {
      field: 'definition.type',
      name: i18n.translate('xpack.entityInventory.definitionsList.typeColumn', {
        defaultMessage: 'Type',
      }),
      render: (_value: unknown, record: EntityDefinitionRecord) => (
        <EuiLink
          data-test-subj="entityInventoryColumnsLink"
          onClick={() => onSelect(record.definition.type)}
        >
          {record.definition.type}
        </EuiLink>
      ),
    },
    {
      field: 'definition.inventory.label',
      name: i18n.translate('xpack.entityInventory.definitionsList.labelColumn', {
        defaultMessage: 'Label',
      }),
      render: (label?: string) => label ?? '-',
    },
    {
      field: 'source',
      name: i18n.translate('xpack.entityInventory.definitionsList.sourceColumn', {
        defaultMessage: 'Source',
      }),
      render: (source: EntityDefinitionRecord['source']) => (
        <EuiBadge color={sourceColor[source]}>{source}</EuiBadge>
      ),
    },
    {
      field: 'inventorySource',
      name: i18n.translate('xpack.entityInventory.definitionsList.inventorySourceColumn', {
        defaultMessage: 'Inventory source',
      }),
      render: (inventorySource?: string) => inventorySource ?? '-',
    },
    {
      field: 'definition.inventory.sources',
      name: i18n.translate('xpack.entityInventory.definitionsList.sourcesColumn', {
        defaultMessage: 'Sources',
      }),
      align: 'right',
      render: (_value: unknown, record: EntityDefinitionRecord) => countSources(record),
    },
  ];

  return (
    <EuiBasicTable
      tableCaption={i18n.translate('xpack.entityInventory.definitionsList.caption', {
        defaultMessage: 'Entity definitions in this space',
      })}
      items={records}
      itemId={(record) => record.definition.type}
      columns={columns}
      loading={isLoading}
      tableLayout="auto"
      rowProps={(record) => ({ onClick: () => onSelect(record.definition.type) })}
      noItemsMessage={i18n.translate('xpack.entityInventory.definitionsList.empty', {
        defaultMessage: 'No entity definitions',
      })}
    />
  );
};
