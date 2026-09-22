/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  EuiButton,
  EuiButtonEmpty,
  EuiConfirmModal,
  EuiPageTemplate,
  EuiSpacer,
  useGeneratedHtmlId,
} from '@elastic/eui';
import type { CoreStart } from '@kbn/core/public';
import type { AgentBuilderPluginStart } from '@kbn/agent-builder-browser';
import type { EntityDefinitionRecord } from '@kbn/entity-store/common';
import { i18n } from '@kbn/i18n';
import { KbnDangerCallout } from '@kbn/ui-callout';
import type { InventoryTypeDescriptor } from '../../common';
import { buildAskAiMessage } from '../lib/ask_ai_message';
import { createDefinitionsApi } from '../lib/definitions_api';
import {
  getDocumentType,
  getEditability,
  type DefinitionDocument,
  type TemplateKind,
} from '../lib/editable_document';
import { describeHttpError, type DescribedError } from '../lib/http_error';
import { createInventoryApi } from '../lib/inventory_api';
import {
  AuthoringConversationFlyout,
  type AuthoringConversation,
} from './authoring_conversation_flyout';
import { DefinitionDetail, type DetailTab } from './definition_detail';
import type { EditorMode } from './definition_editor';
import { DefinitionsTable } from './definitions_table';

interface DefinitionsAppProps {
  core: CoreStart;
  agentBuilder?: AgentBuilderPluginStart;
}

type View =
  | { name: 'list' }
  | { name: 'detail'; type: string; tab: DetailTab }
  | { name: 'create'; template: TemplateKind; extendsType?: string };

const LIST_VIEW: View = { name: 'list' };

export const DefinitionsApp = ({ core, agentBuilder }: DefinitionsAppProps) => {
  const { http, notifications } = core;
  const definitionsApi = useMemo(() => createDefinitionsApi(http), [http]);
  const inventoryApi = useMemo(() => createInventoryApi(http), [http]);

  const [records, setRecords] = useState<EntityDefinitionRecord[]>([]);
  const [previewDescriptors, setPreviewDescriptors] = useState<InventoryTypeDescriptor[]>([]);
  const previewTypes = previewDescriptors.map(({ type }) => type);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<DescribedError | undefined>();
  const [view, setView] = useState<View>(LIST_VIEW);
  const [pendingDelete, setPendingDelete] = useState<EntityDefinitionRecord | undefined>();
  const [isDeleting, setIsDeleting] = useState(false);
  const [conversation, setConversation] = useState<AuthoringConversation | undefined>();
  const confirmTitleId = useGeneratedHtmlId({ prefix: 'entityInventoryDeleteFromList' });

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const { definitions } = await definitionsApi.list();
      setRecords(definitions);
      setLoadError(undefined);
    } catch (error) {
      setLoadError(describeHttpError(error));
    }
    try {
      const { types } = await inventoryApi.types();
      setPreviewDescriptors(types);
    } catch {
      // The preview is optional: a failing types route only disables it.
      setPreviewDescriptors([]);
    }
    setIsLoading(false);
  }, [definitionsApi, inventoryApi]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openDetail = (type: string, tab: DetailTab = 'definition') =>
    setView({ name: 'detail', type, tab });

  // The agent may have created or changed definitions; reload once the conversation closes.
  const closeConversation = async () => {
    setConversation(undefined);
    await refresh();
  };
  const askAiAbout = (record: EntityDefinitionRecord) => {
    const { type } = record.definition;
    setConversation({
      kind: 'ask',
      type,
      initialMessage: buildAskAiMessage(type, getEditability(record).document),
    });
  };
  const conversationFlyout =
    agentBuilder !== undefined && conversation !== undefined ? (
      <AuthoringConversationFlyout
        agentBuilder={agentBuilder}
        conversation={conversation}
        onClose={closeConversation}
      />
    ) : null;
  const startNew = (template: TemplateKind, extendsType?: string) =>
    setView({ name: 'create', template, extendsType });

  const notifySaved = (type: string) =>
    notifications.toasts.addSuccess(
      i18n.translate('xpack.entityInventory.app.savedToast', {
        defaultMessage: 'Saved {type}',
        values: { type },
      })
    );
  const notifyDeleted = (type: string) =>
    notifications.toasts.addSuccess(
      i18n.translate('xpack.entityInventory.app.deletedToast', {
        defaultMessage: 'Deleted {type}',
        values: { type },
      })
    );

  const handleSave = async (document: DefinitionDocument) => {
    const saved =
      view.name === 'detail'
        ? await definitionsApi.replace(view.type, document)
        : await definitionsApi.create(document);
    notifySaved(getDocumentType(document) ?? saved.definition.type);
    openDetail(saved.definition.type);
    await refresh();
  };

  // Deleting from the detail view; errors propagate to the editor's callout.
  const handleDeleteFromDetail = async (type: string) => {
    await definitionsApi.remove(type);
    notifyDeleted(type);
    setView(LIST_VIEW);
    await refresh();
  };

  // Deleting from the list's action column; errors go to a toast since there is no editor.
  const confirmDeleteFromList = async () => {
    if (pendingDelete === undefined) {
      return;
    }
    const { type } = pendingDelete.definition;
    setIsDeleting(true);
    try {
      await definitionsApi.remove(type);
      notifyDeleted(type);
      await refresh();
    } catch (error) {
      const { statusCode, message } = describeHttpError(error);
      notifications.toasts.addDanger({
        title: i18n.translate('xpack.entityInventory.app.deleteFailedToast', {
          defaultMessage: 'Could not delete {type}',
          values: { type },
        }),
        text: statusCode !== undefined ? `[${statusCode}] ${message}` : message,
      });
    } finally {
      setIsDeleting(false);
      setPendingDelete(undefined);
    }
  };

  const detailRecord =
    view.name === 'detail'
      ? records.find(({ definition }) => definition.type === view.type)
      : undefined;
  const detailMode: EditorMode | undefined =
    view.name === 'create'
      ? { kind: 'new', template: view.template, extendsType: view.extendsType }
      : detailRecord !== undefined
      ? { kind: 'edit', record: detailRecord }
      : undefined;

  // A detail view whose record vanished (deleted elsewhere, or the type never existed) goes back to the list.
  useEffect(() => {
    if (view.name === 'detail' && !isLoading && detailRecord === undefined) {
      setView(LIST_VIEW);
    }
  }, [view, isLoading, detailRecord]);

  if (detailMode !== undefined) {
    const key =
      detailMode.kind === 'new'
        ? `new:${detailMode.template}:${detailMode.extendsType ?? ''}`
        : `edit:${detailMode.record.definition.type}:${detailMode.record.updatedAt ?? ''}`;
    return (
      <>
        <DefinitionDetail
          key={key}
          mode={detailMode}
          tab={view.name === 'detail' ? view.tab : 'definition'}
          isPreviewAvailable={
            detailRecord !== undefined && previewTypes.includes(detailRecord.definition.type)
          }
          inventoryIdentity={
            previewDescriptors.find(({ type }) => type === detailRecord?.definition.type)?.identity
          }
          inventoryApi={inventoryApi}
          onTabChange={(tab) =>
            detailRecord !== undefined && openDetail(detailRecord.definition.type, tab)
          }
          onBack={() => setView(LIST_VIEW)}
          onSave={handleSave}
          onDelete={handleDeleteFromDetail}
          onAddExtension={(type) => startNew('extension', type)}
          onAskAi={agentBuilder !== undefined ? askAiAbout : undefined}
        />
        {conversationFlyout}
      </>
    );
  }

  return (
    <EuiPageTemplate>
      <EuiPageTemplate.Header
        pageTitle={i18n.translate('xpack.entityInventory.app.pageTitle', {
          defaultMessage: 'Entity definitions',
        })}
        description={i18n.translate('xpack.entityInventory.app.pageDescription', {
          defaultMessage:
            'Entity definitions and built-in inventory extensions registered in this space. Open one to edit its JSON or preview what the inventory returns.',
        })}
        rightSideItems={[
          ...(agentBuilder !== undefined
            ? [
                <EuiButton
                  data-test-subj="entityInventoryDefinitionsAppCreateWithAiButton"
                  fill
                  iconType="sparkles"
                  onClick={() => setConversation({ kind: 'create' })}
                >
                  {i18n.translate('xpack.entityInventory.app.createWithAiButton', {
                    defaultMessage: 'Create with AI',
                  })}
                </EuiButton>,
              ]
            : []),
          <EuiButton
            data-test-subj="entityInventoryDefinitionsAppNewDefinitionButton"
            fill={agentBuilder === undefined}
            iconType="plus"
            onClick={() => startNew('definition')}
          >
            {i18n.translate('xpack.entityInventory.app.newDefinitionButton', {
              defaultMessage: 'New definition',
            })}
          </EuiButton>,
          <EuiButton
            data-test-subj="entityInventoryDefinitionsAppNewExtensionButton"
            iconType="plusCircle"
            onClick={() => startNew('extension')}
          >
            {i18n.translate('xpack.entityInventory.app.newExtensionButton', {
              defaultMessage: 'New extension',
            })}
          </EuiButton>,
          <EuiButtonEmpty
            data-test-subj="entityInventoryDefinitionsAppReloadButton"
            iconType="refresh"
            onClick={refresh}
            isLoading={isLoading}
          >
            {i18n.translate('xpack.entityInventory.app.reloadButton', {
              defaultMessage: 'Reload',
            })}
          </EuiButtonEmpty>,
        ]}
      />
      <EuiPageTemplate.Section paddingSize="l">
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
            <EuiSpacer size="l" />
          </>
        )}
        <DefinitionsTable
          records={records}
          previewTypes={previewTypes}
          isLoading={isLoading}
          onOpen={(type) => openDetail(type)}
          onPreview={(type) => openDetail(type, 'preview')}
          onDelete={setPendingDelete}
        />
      </EuiPageTemplate.Section>

      {pendingDelete !== undefined && (
        <EuiConfirmModal
          aria-labelledby={confirmTitleId}
          titleProps={{ id: confirmTitleId }}
          title={i18n.translate('xpack.entityInventory.app.deleteConfirm.title', {
            defaultMessage: 'Delete {type}?',
            values: { type: pendingDelete.definition.type },
          })}
          onCancel={() => setPendingDelete(undefined)}
          onConfirm={confirmDeleteFromList}
          cancelButtonText={i18n.translate('xpack.entityInventory.app.deleteConfirm.cancel', {
            defaultMessage: 'Cancel',
          })}
          confirmButtonText={i18n.translate('xpack.entityInventory.app.deleteConfirm.confirm', {
            defaultMessage: 'Delete',
          })}
          buttonColor="danger"
          isLoading={isDeleting}
        >
          <p>
            {getEditability(pendingDelete).kind === 'extension'
              ? i18n.translate('xpack.entityInventory.app.deleteConfirm.extensionBody', {
                  defaultMessage:
                    'The inventory extension registered through the API for this built-in type is removed from this space. The built-in type itself is kept.',
                })
              : i18n.translate('xpack.entityInventory.app.deleteConfirm.definitionBody', {
                  defaultMessage: 'The definition is removed from this space.',
                })}
          </p>
        </EuiConfirmModal>
      )}
      {conversationFlyout}
    </EuiPageTemplate>
  );
};
