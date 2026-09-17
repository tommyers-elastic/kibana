/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { css } from '@emotion/react';
import { EuiFlyout, EuiLoadingSpinner, useEuiTheme, useGeneratedHtmlId } from '@elastic/eui';
import type { AgentBuilderPluginStart } from '@kbn/agent-builder-browser';
import { i18n } from '@kbn/i18n';
import {
  DEFINITION_AUTHORING_AGENT_ID,
  DEFINITION_AUTHORING_SESSION_TAG,
} from '../lib/ask_ai_message';

/** Start a fresh conversation about one document, or resume the authoring session. */
export type AuthoringConversation =
  | { kind: 'create' }
  | { kind: 'ask'; type: string; initialMessage: string };

interface AuthoringConversationFlyoutProps {
  agentBuilder: AgentBuilderPluginStart;
  conversation: AuthoringConversation;
  onClose: () => void;
}

const greeting = i18n.translate('xpack.entityInventory.authoring.greeting', {
  defaultMessage:
    'Name the entity type you want in the inventory, for example "Kubernetes jobs" or "hosts from the system integration". I will inspect the telemetry, propose a definition with the evidence, and preview it before saving.',
});

const loadingLabel = i18n.translate('xpack.entityInventory.authoring.loading', {
  defaultMessage: 'Loading the conversation',
});

/** Flyout hosting the dedicated definition authoring agent conversation. */
export const AuthoringConversationFlyout = ({
  agentBuilder,
  conversation,
  onClose,
}: AuthoringConversationFlyoutProps) => {
  const { euiTheme } = useEuiTheme();
  const titleId = useGeneratedHtmlId({ prefix: 'entityInventoryAuthoringConversation' });
  const { EmbeddableConversation } = agentBuilder;

  return (
    <EuiFlyout
      ownFocus
      size="l"
      onClose={onClose}
      aria-labelledby={titleId}
      data-test-subj="entityInventoryAuthoringConversationFlyout"
      // The conversation renders its own header and close action.
      hideCloseButton
      paddingSize="none"
    >
      <div
        css={css`
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
          height: 100%;
          overflow: hidden;
          background: ${euiTheme.colors.body};
        `}
      >
        <React.Suspense
          fallback={
            <div
              css={css`
                display: flex;
                flex: 1;
                align-items: center;
                justify-content: center;
              `}
            >
              <EuiLoadingSpinner size="xl" aria-label={loadingLabel} />
            </div>
          }
        >
          <EmbeddableConversation
            agentId={DEFINITION_AUTHORING_AGENT_ID}
            sessionTag={DEFINITION_AUTHORING_SESSION_TAG}
            greetingMessage={greeting}
            ariaLabelledBy={titleId}
            onClose={onClose}
            {...(conversation.kind === 'ask'
              ? { newConversation: true, initialMessage: conversation.initialMessage }
              : {})}
          />
        </React.Suspense>
      </div>
    </EuiFlyout>
  );
};
