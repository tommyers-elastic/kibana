/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { EuiPageTemplate } from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import type { DefinitionDocument } from '../lib/editable_document';
import type { InventoryApi } from '../lib/inventory_api';
import { getRecordKind } from '../lib/record_summary';
import { DefinitionEditor, type EditorMode } from './definition_editor';
import { InventoryPreview } from './inventory_preview';
import { KindBadge } from './kind_badge';

export type DetailTab = 'definition' | 'preview';

interface DefinitionDetailProps {
  mode: EditorMode;
  tab: DetailTab;
  isPreviewAvailable: boolean;
  inventoryApi: InventoryApi;
  onTabChange: (tab: DetailTab) => void;
  onBack: () => void;
  onSave: (document: DefinitionDocument) => Promise<void>;
  onDelete: (type: string) => Promise<void>;
  onAddExtension: (type: string) => void;
}

const definitionsCrumb = i18n.translate('xpack.entityInventory.detail.breadcrumb', {
  defaultMessage: 'Definitions',
});

const newTitle = (mode: Extract<EditorMode, { kind: 'new' }>): string =>
  mode.template === 'extension'
    ? i18n.translate('xpack.entityInventory.detail.newExtensionTitle', {
        defaultMessage: 'New extension of {type}',
        values: { type: mode.extendsType ?? 'host' },
      })
    : i18n.translate('xpack.entityInventory.detail.newDefinitionTitle', {
        defaultMessage: 'New definition',
      });

/** Full-width detail page: header with breadcrumb and Kind badge, then Definition / Preview tabs. */
export const DefinitionDetail = ({
  mode,
  tab,
  isPreviewAvailable,
  inventoryApi,
  onTabChange,
  onBack,
  onSave,
  onDelete,
  onAddExtension,
}: DefinitionDetailProps) => {
  const record = mode.kind === 'edit' ? mode.record : undefined;
  const title = mode.kind === 'new' ? newTitle(mode) : mode.record.definition.type;
  const activeTab: DetailTab = record === undefined ? 'definition' : tab;

  const tabs = [
    {
      label: i18n.translate('xpack.entityInventory.detail.definitionTab', {
        defaultMessage: 'Definition',
      }),
      isSelected: activeTab === 'definition',
      onClick: () => onTabChange('definition'),
    },
    ...(record !== undefined
      ? [
          {
            label: i18n.translate('xpack.entityInventory.detail.previewTab', {
              defaultMessage: 'Preview',
            }),
            isSelected: activeTab === 'preview',
            onClick: () => onTabChange('preview'),
          },
        ]
      : []),
  ];

  return (
    <EuiPageTemplate>
      <EuiPageTemplate.Header
        breadcrumbs={[{ text: definitionsCrumb, onClick: onBack }, { text: title }]}
        pageTitle={title}
        description={record?.definition.name}
        rightSideItems={record !== undefined ? [<KindBadge kind={getRecordKind(record)} />] : []}
        tabs={tabs}
      />
      <EuiPageTemplate.Section paddingSize="l">
        {activeTab === 'preview' && record !== undefined ? (
          <InventoryPreview
            key={record.definition.type}
            type={record.definition.type}
            isAvailable={isPreviewAvailable}
            api={inventoryApi}
          />
        ) : (
          <DefinitionEditor
            mode={mode}
            onSave={onSave}
            onDelete={onDelete}
            onCancel={onBack}
            onAddExtension={onAddExtension}
          />
        )}
      </EuiPageTemplate.Section>
    </EuiPageTemplate>
  );
};
