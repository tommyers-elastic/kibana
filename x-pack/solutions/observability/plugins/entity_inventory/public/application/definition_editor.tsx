/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useMemo, useState } from 'react';
import {
  EuiBadge,
  EuiButton,
  EuiButtonEmpty,
  EuiButtonGroup,
  EuiConfirmModal,
  EuiFlexGroup,
  EuiFlexItem,
  EuiSpacer,
  EuiTitle,
  useGeneratedHtmlId,
} from '@elastic/eui';
import { CodeEditor } from '@kbn/code-editor';
import { i18n } from '@kbn/i18n';
import type { EntityDefinitionRecord } from '@kbn/entity-store/common';
import { KbnDangerCallout, KbnInfoCallout } from '@kbn/ui-callout';
import {
  getEditability,
  getTemplate,
  parseDocument,
  stringifyDocument,
  type DefinitionDocument,
  type ReadOnlyReason,
  type TemplateKind,
} from '../lib/editable_document';
import { describeHttpError, type DescribedError } from '../lib/http_error';

export type EditorMode =
  | { kind: 'edit'; record: EntityDefinitionRecord }
  | { kind: 'new'; template: TemplateKind; extendsType?: string };

interface DefinitionEditorProps {
  mode: EditorMode;
  onSave: (document: DefinitionDocument) => Promise<void>;
  onDelete: (type: string) => Promise<void>;
  onAddExtension: (type: string) => void;
}

const EDITOR_HEIGHT = 480;

const readOnlyExplanation: Record<ReadOnlyReason, string> = {
  code: i18n.translate('xpack.entityInventory.editor.readOnly.code', {
    defaultMessage:
      'This definition is registered in code by a plugin at setup and cannot be changed through the API.',
  }),
  built_in_without_extension: i18n.translate(
    'xpack.entityInventory.editor.readOnly.builtInWithoutExtension',
    {
      defaultMessage:
        'This is a built-in Security type without an inventory extension. The type itself cannot be edited, but an inventory extension can be added for it in this space.',
    }
  ),
  built_in_code_extension: i18n.translate(
    'xpack.entityInventory.editor.readOnly.builtInCodeExtension',
    {
      defaultMessage:
        'This built-in type carries an inventory extension registered in code, which wins over API extensions; the API can neither replace nor delete it.',
    }
  ),
};

const templateOptions = [
  {
    id: 'definition' satisfies TemplateKind,
    label: i18n.translate('xpack.entityInventory.editor.template.definition', {
      defaultMessage: 'Definition',
    }),
  },
  {
    id: 'extension' satisfies TemplateKind,
    label: i18n.translate('xpack.entityInventory.editor.template.extension', {
      defaultMessage: 'Built-in extension',
    }),
  },
];

const initialText = (mode: EditorMode): string =>
  stringifyDocument(
    mode.kind === 'new'
      ? getTemplate(mode.template, mode.extendsType)
      : getEditability(mode.record).document
  );

/**
 * JSON editor for one definition or extension document. The parent re-keys this component per
 * selection, so local state (text, errors) resets when another record is selected.
 */
export const DefinitionEditor = ({
  mode,
  onSave,
  onDelete,
  onAddExtension,
}: DefinitionEditorProps) => {
  const [text, setText] = useState<string>(() => initialText(mode));
  const [templateKind, setTemplateKind] = useState<TemplateKind>(
    mode.kind === 'new' ? mode.template : 'definition'
  );
  const [serverError, setServerError] = useState<DescribedError | undefined>();
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const confirmTitleId = useGeneratedHtmlId({ prefix: 'entityInventoryDeleteDefinition' });

  const editability = useMemo(
    () => (mode.kind === 'edit' ? getEditability(mode.record) : undefined),
    [mode]
  );
  const isReadOnly = editability?.kind === 'read_only';
  const recordType = mode.kind === 'edit' ? mode.record.definition.type : undefined;

  const handleTemplateChange = (id: string) => {
    const kind = id as TemplateKind;
    setTemplateKind(kind);
    setText(
      stringifyDocument(getTemplate(kind, mode.kind === 'new' ? mode.extendsType : undefined))
    );
    setServerError(undefined);
  };

  const handleSave = async () => {
    const parsed = parseDocument(text);
    if ('error' in parsed) {
      setServerError({ message: parsed.error });
      return;
    }
    setIsSaving(true);
    setServerError(undefined);
    try {
      await onSave(parsed.document);
    } catch (error) {
      setServerError(describeHttpError(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (recordType === undefined) {
      return;
    }
    setIsDeleting(true);
    setServerError(undefined);
    try {
      await onDelete(recordType);
    } catch (error) {
      setServerError(describeHttpError(error));
    } finally {
      setIsDeleting(false);
      setIsConfirmingDelete(false);
    }
  };

  const title =
    mode.kind === 'new'
      ? i18n.translate('xpack.entityInventory.editor.newTitle', {
          defaultMessage: 'New document',
        })
      : mode.record.definition.type;

  return (
    <>
      <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
        <EuiFlexItem grow={false}>
          <EuiTitle size="s">
            <h2>{title}</h2>
          </EuiTitle>
        </EuiFlexItem>
        {mode.kind === 'edit' && (
          <>
            <EuiFlexItem grow={false}>
              <EuiBadge color="hollow">{mode.record.source}</EuiBadge>
            </EuiFlexItem>
            {mode.record.inventorySource && (
              <EuiFlexItem grow={false}>
                <EuiBadge color="hollow">
                  {i18n.translate('xpack.entityInventory.editor.inventorySourceBadge', {
                    defaultMessage: 'inventory: {source}',
                    values: { source: mode.record.inventorySource },
                  })}
                </EuiBadge>
              </EuiFlexItem>
            )}
          </>
        )}
      </EuiFlexGroup>
      <EuiSpacer size="s" />

      {mode.kind === 'new' && (
        <>
          <EuiButtonGroup
            legend={i18n.translate('xpack.entityInventory.editor.template.legend', {
              defaultMessage: 'Template',
            })}
            options={templateOptions}
            idSelected={templateKind}
            onChange={handleTemplateChange}
            buttonSize="compressed"
          />
          <EuiSpacer size="s" />
        </>
      )}

      {editability?.kind === 'read_only' && (
        <>
          <KbnInfoCallout
            size="s"
            title={i18n.translate('xpack.entityInventory.editor.readOnly.title', {
              defaultMessage: 'Read-only',
            })}
          >
            <p>{readOnlyExplanation[editability.reason]}</p>
            {editability.reason === 'built_in_without_extension' && recordType !== undefined && (
              <EuiButton
                data-test-subj="entityInventoryDefinitionEditorAddInventoryExtensionButton"
                size="s"
                onClick={() => onAddExtension(recordType)}
              >
                {i18n.translate('xpack.entityInventory.editor.addExtensionButton', {
                  defaultMessage: 'Add inventory extension',
                })}
              </EuiButton>
            )}
          </KbnInfoCallout>
          <EuiSpacer size="s" />
        </>
      )}

      {editability?.kind === 'extension' && (
        <>
          <KbnInfoCallout
            size="s"
            title={i18n.translate('xpack.entityInventory.editor.extensionHint', {
              defaultMessage:
                'Editing the inventory extension of a built-in type; the document is sent as-is to PUT /internal/entity_store/definitions/{type}.',
              values: { type: recordType },
            })}
          />
          <EuiSpacer size="s" />
        </>
      )}

      {serverError && (
        <>
          <KbnDangerCallout
            title={
              serverError.statusCode !== undefined
                ? i18n.translate('xpack.entityInventory.editor.serverError.titleWithStatus', {
                    defaultMessage: 'Request failed ({statusCode})',
                    values: { statusCode: serverError.statusCode },
                  })
                : i18n.translate('xpack.entityInventory.editor.serverError.title', {
                    defaultMessage: 'Invalid document',
                  })
            }
          >
            <p>{serverError.message}</p>
          </KbnDangerCallout>
          <EuiSpacer size="s" />
        </>
      )}

      <CodeEditor
        languageId="json"
        value={text}
        onChange={setText}
        height={EDITOR_HEIGHT}
        options={{ readOnly: isReadOnly, minimap: { enabled: false }, tabSize: 2 }}
      />
      <EuiSpacer size="s" />

      <EuiFlexGroup gutterSize="s" responsive={false}>
        <EuiFlexItem grow={false}>
          <EuiButton
            data-test-subj="entityInventoryDefinitionEditorButton"
            fill
            onClick={handleSave}
            isLoading={isSaving}
            isDisabled={isReadOnly}
          >
            {mode.kind === 'new'
              ? i18n.translate('xpack.entityInventory.editor.createButton', {
                  defaultMessage: 'Create',
                })
              : i18n.translate('xpack.entityInventory.editor.saveButton', {
                  defaultMessage: 'Save',
                })}
          </EuiButton>
        </EuiFlexItem>
        {mode.kind === 'edit' && !isReadOnly && (
          <EuiFlexItem grow={false}>
            <EuiButtonEmpty
              data-test-subj="entityInventoryDefinitionEditorButton"
              color="danger"
              onClick={() => setIsConfirmingDelete(true)}
              isLoading={isDeleting}
            >
              {editability?.kind === 'extension'
                ? i18n.translate('xpack.entityInventory.editor.deleteExtensionButton', {
                    defaultMessage: 'Delete extension',
                  })
                : i18n.translate('xpack.entityInventory.editor.deleteButton', {
                    defaultMessage: 'Delete',
                  })}
            </EuiButtonEmpty>
          </EuiFlexItem>
        )}
      </EuiFlexGroup>

      {isConfirmingDelete && recordType !== undefined && (
        <EuiConfirmModal
          aria-labelledby={confirmTitleId}
          titleProps={{ id: confirmTitleId }}
          title={i18n.translate('xpack.entityInventory.editor.deleteConfirm.title', {
            defaultMessage: 'Delete {type}?',
            values: { type: recordType },
          })}
          onCancel={() => setIsConfirmingDelete(false)}
          onConfirm={handleDelete}
          cancelButtonText={i18n.translate('xpack.entityInventory.editor.deleteConfirm.cancel', {
            defaultMessage: 'Cancel',
          })}
          confirmButtonText={i18n.translate('xpack.entityInventory.editor.deleteConfirm.confirm', {
            defaultMessage: 'Delete',
          })}
          buttonColor="danger"
          isLoading={isDeleting}
        >
          <p>
            {editability?.kind === 'extension'
              ? i18n.translate('xpack.entityInventory.editor.deleteConfirm.extensionBody', {
                  defaultMessage:
                    'The inventory extension registered through the API for this built-in type is removed from this space. The built-in type itself is kept.',
                })
              : i18n.translate('xpack.entityInventory.editor.deleteConfirm.definitionBody', {
                  defaultMessage: 'The definition is removed from this space.',
                })}
          </p>
        </EuiConfirmModal>
      )}
    </>
  );
};
