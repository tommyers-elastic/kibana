/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  EuiButton,
  EuiEmptyPrompt,
  EuiFlexGroup,
  EuiFlexItem,
  EuiHorizontalRule,
  EuiPageTemplate,
  EuiSpacer,
} from '@elastic/eui';
import type { CoreStart } from '@kbn/core/public';
import type { EntityDefinitionRecord } from '@kbn/entity-store/common';
import { i18n } from '@kbn/i18n';
import { KbnDangerCallout } from '@kbn/ui-callout';
import { createDefinitionsApi } from '../lib/definitions_api';
import {
  getDocumentType,
  type DefinitionDocument,
  type TemplateKind,
} from '../lib/editable_document';
import { describeHttpError, type DescribedError } from '../lib/http_error';
import { createInventoryApi } from '../lib/inventory_api';
import { DefinitionEditor, type EditorMode } from './definition_editor';
import { DefinitionsList } from './definitions_list';
import { InventoryPreview } from './inventory_preview';

interface DefinitionsAppProps {
  core: CoreStart;
}

type Selection =
  | { kind: 'record'; type: string }
  | { kind: 'new'; template: TemplateKind; extendsType?: string };

const byType = (left: EntityDefinitionRecord, right: EntityDefinitionRecord): number =>
  left.definition.type.localeCompare(right.definition.type);

export const DefinitionsApp = ({ core }: DefinitionsAppProps) => {
  const { http, notifications } = core;
  const definitionsApi = useMemo(() => createDefinitionsApi(http), [http]);
  const inventoryApi = useMemo(() => createInventoryApi(http), [http]);

  const [records, setRecords] = useState<EntityDefinitionRecord[]>([]);
  const [previewTypes, setPreviewTypes] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<DescribedError | undefined>();
  const [selection, setSelection] = useState<Selection | undefined>();

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const { definitions } = await definitionsApi.list();
      setRecords([...definitions].sort(byType));
      setLoadError(undefined);
    } catch (error) {
      setLoadError(describeHttpError(error));
    }
    try {
      const { types } = await inventoryApi.types();
      setPreviewTypes(types.map(({ type }) => type));
    } catch {
      // The preview is optional: a failing types route only disables it.
      setPreviewTypes([]);
    }
    setIsLoading(false);
  }, [definitionsApi, inventoryApi]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedRecord =
    selection?.kind === 'record'
      ? records.find(({ definition }) => definition.type === selection.type)
      : undefined;

  const editorMode: EditorMode | undefined =
    selection?.kind === 'new'
      ? selection
      : selectedRecord !== undefined
      ? { kind: 'edit', record: selectedRecord }
      : undefined;

  const editorKey =
    selection?.kind === 'new'
      ? `new:${selection.template}:${selection.extendsType ?? ''}`
      : `record:${selectedRecord?.definition.type ?? ''}:${selectedRecord?.updatedAt ?? ''}`;

  const handleSave = async (document: DefinitionDocument) => {
    const savedType =
      selection?.kind === 'record'
        ? (await definitionsApi.replace(selection.type, document)).definition.type
        : (await definitionsApi.create(document)).definition.type;
    notifications.toasts.addSuccess(
      i18n.translate('xpack.entityInventory.app.savedToast', {
        defaultMessage: 'Saved {type}',
        values: { type: getDocumentType(document) ?? savedType },
      })
    );
    setSelection({ kind: 'record', type: savedType });
    await refresh();
  };

  const handleDelete = async (type: string) => {
    await definitionsApi.remove(type);
    notifications.toasts.addSuccess(
      i18n.translate('xpack.entityInventory.app.deletedToast', {
        defaultMessage: 'Deleted {type}',
        values: { type },
      })
    );
    setSelection(undefined);
    await refresh();
  };

  const startNew = (template: TemplateKind, extendsType?: string) =>
    setSelection({ kind: 'new', template, extendsType });

  return (
    <EuiPageTemplate>
      <EuiPageTemplate.Header
        pageTitle={i18n.translate('xpack.entityInventory.app.pageTitle', {
          defaultMessage: 'Entity definitions',
        })}
        description={i18n.translate('xpack.entityInventory.app.pageDescription', {
          defaultMessage:
            'Development view of the entity definitions and built-in inventory extensions registered in this space, with a live inventory preview.',
        })}
        rightSideItems={[
          <EuiButton
            data-test-subj="entityInventoryDefinitionsAppNewButton"
            fill
            iconType="plus"
            onClick={() => startNew('definition')}
          >
            {i18n.translate('xpack.entityInventory.app.newButton', { defaultMessage: 'New' })}
          </EuiButton>,
          <EuiButton
            data-test-subj="entityInventoryDefinitionsAppReloadButton"
            iconType="refresh"
            onClick={refresh}
            isLoading={isLoading}
          >
            {i18n.translate('xpack.entityInventory.app.reloadButton', {
              defaultMessage: 'Reload',
            })}
          </EuiButton>,
        ]}
      />
      <EuiPageTemplate.Section>
        {loadError && (
          <>
            <KbnDangerCallout
              title={i18n.translate('xpack.entityInventory.app.loadError', {
                defaultMessage: 'Could not load the definitions',
              })}
            >
              <p>
                {loadError.statusCode !== undefined
                  ? `[${loadError.statusCode}] ${loadError.message}`
                  : loadError.message}
              </p>
            </KbnDangerCallout>
            <EuiSpacer size="m" />
          </>
        )}
        <EuiFlexGroup alignItems="flexStart" gutterSize="l">
          <EuiFlexItem grow={2}>
            <DefinitionsList
              records={records}
              selectedType={selectedRecord?.definition.type}
              isLoading={isLoading}
              onSelect={(type) => setSelection({ kind: 'record', type })}
            />
          </EuiFlexItem>
          <EuiFlexItem grow={3}>
            {editorMode === undefined ? (
              <EuiEmptyPrompt
                iconType="documents"
                titleSize="s"
                title={
                  <h2>
                    {i18n.translate('xpack.entityInventory.app.emptyTitle', {
                      defaultMessage: 'Select a definition or create a new one',
                    })}
                  </h2>
                }
              />
            ) : (
              <>
                <DefinitionEditor
                  key={editorKey}
                  mode={editorMode}
                  onSave={handleSave}
                  onDelete={handleDelete}
                  onAddExtension={(type) => startNew('extension', type)}
                />
                {selectedRecord && (
                  <>
                    <EuiHorizontalRule />
                    <InventoryPreview
                      key={selectedRecord.definition.type}
                      type={selectedRecord.definition.type}
                      isAvailable={previewTypes.includes(selectedRecord.definition.type)}
                      api={inventoryApi}
                    />
                  </>
                )}
              </>
            )}
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiPageTemplate.Section>
    </EuiPageTemplate>
  );
};
