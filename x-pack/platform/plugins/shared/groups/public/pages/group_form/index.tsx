/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useEffect, useState } from 'react';
import {
  EuiPage,
  EuiPageBody,
  EuiPageHeader,
  EuiPageSection,
  EuiButton,
  EuiButtonEmpty,
  EuiForm,
  EuiFormRow,
  EuiFieldText,
  EuiTextArea,
  EuiSpacer,
  EuiFlexGroup,
  EuiFlexItem,
  EuiLoadingSpinner,
  EuiEmptyPrompt,
  EuiCallOut,
} from '@elastic/eui';
import { useParams, useHistory } from 'react-router-dom';
import { useKibana } from '@kbn/kibana-react-plugin/public';
import type { CoreStart } from '@kbn/core/public';
import { GroupsAPIClient } from '../../services/api_client';

export const GroupForm: React.FC = () => {
  const { groupId } = useParams<{ groupId?: string }>();
  const history = useHistory();
  const { services } = useKibana<CoreStart>();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const isEditMode = !!groupId;
  const apiClient = React.useMemo(() => new GroupsAPIClient(services.http), [services.http]);

  const fetchGroup = React.useCallback(async () => {
    if (!groupId) return;

    setLoading(true);
    setError(null);
    try {
      const group = await apiClient.getGroup(groupId);
      setName(group.name);
      setDescription(group.description || '');
    } catch (err) {
      setError(err.message || 'Failed to load group');
      services.notifications.toasts.addError(err, {
        title: 'Failed to load group',
      });
    } finally {
      setLoading(false);
    }
  }, [apiClient, groupId, services.notifications.toasts]);

  useEffect(() => {
    if (isEditMode) {
      fetchGroup();
    }
  }, [isEditMode, fetchGroup]);

  const validateForm = (): boolean => {
    let isValid = true;

    if (!name.trim()) {
      setNameError('Name is required');
      isValid = false;
    } else if (name.length > 255) {
      setNameError('Name must be 255 characters or less');
      isValid = false;
    } else {
      setNameError(null);
    }

    return isValid;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setSaving(true);
    try {
      if (isEditMode && groupId) {
        await apiClient.updateGroup(groupId, {
          name: name.trim(),
          description: description.trim() || undefined,
        });
        services.notifications.toasts.addSuccess({
          title: 'Group updated successfully',
        });
        history.push(`/${groupId}`);
      } else {
        const newGroup = await apiClient.createGroup({
          name: name.trim(),
          description: description.trim() || undefined,
        });
        services.notifications.toasts.addSuccess({
          title: 'Group created successfully',
        });
        history.push(`/${newGroup.id}`);
      }
    } catch (err) {
      services.notifications.toasts.addError(err, {
        title: isEditMode ? 'Failed to update group' : 'Failed to create group',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (isEditMode && groupId) {
      history.push(`/${groupId}`);
    } else {
      history.push('/');
    }
  };

  if (loading) {
    return (
      <EuiPage restrictWidth>
        <EuiPageBody>
          <EuiEmptyPrompt
            icon={<EuiLoadingSpinner size="xl" />}
            title={<h2>Loading group...</h2>}
          />
        </EuiPageBody>
      </EuiPage>
    );
  }

  if (error) {
    return (
      <EuiPage restrictWidth>
        <EuiPageBody>
          <EuiEmptyPrompt
            iconType="error"
            color="danger"
            title={<h2>Error loading group</h2>}
            body={<p>{error}</p>}
            actions={[
              <EuiButton onClick={() => history.push('/')} fill>
                Back to groups
              </EuiButton>,
              <EuiButtonEmpty onClick={fetchGroup}>Retry</EuiButtonEmpty>,
            ]}
          />
        </EuiPageBody>
      </EuiPage>
    );
  }

  return (
    <EuiPage restrictWidth>
      <EuiPageBody>
        <EuiPageHeader
          pageTitle={isEditMode ? 'Edit group' : 'Create group'}
          description={
            isEditMode
              ? 'Update the name and description of this group'
              : 'Create a new group to organize your dashboards, rules, SLOs, and other assets'
          }
          rightSideItems={[
            <EuiButtonEmpty onClick={handleCancel} iconType="arrowLeft">
              Cancel
            </EuiButtonEmpty>,
          ]}
        />

        <EuiPageSection>
          <form onSubmit={handleSubmit}>
            <EuiForm component="div">
              <EuiFormRow
                label="Name"
                helpText="A descriptive name for this group"
                isInvalid={!!nameError}
                error={nameError}
              >
                <EuiFieldText
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameError(null);
                  }}
                  placeholder="e.g., Payment Service Health"
                  isInvalid={!!nameError}
                  disabled={saving}
                />
              </EuiFormRow>

              <EuiFormRow
                label="Description"
                helpText="Optional description to help others understand the purpose of this group"
              >
                <EuiTextArea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g., All assets for monitoring the payment service"
                  rows={4}
                  disabled={saving}
                />
              </EuiFormRow>

              {!isEditMode && (
                <>
                  <EuiSpacer />
                  <EuiCallOut
                    title="What are groups?"
                    color="primary"
                    iconType="iInCircle"
                    size="s"
                  >
                    <p>
                      Groups help you organize related assets together. After creating a group,
                      you&apos;ll be able to add dashboards, rules, SLOs, streams, and other assets
                      to it.
                    </p>
                  </EuiCallOut>
                </>
              )}

              <EuiSpacer />

              <EuiFlexGroup>
                <EuiFlexItem grow={false}>
                  <EuiButton type="submit" fill isLoading={saving}>
                    {isEditMode ? 'Update group' : 'Create group'}
                  </EuiButton>
                </EuiFlexItem>
                <EuiFlexItem grow={false}>
                  <EuiButtonEmpty onClick={handleCancel} disabled={saving}>
                    Cancel
                  </EuiButtonEmpty>
                </EuiFlexItem>
              </EuiFlexGroup>
            </EuiForm>
          </form>
        </EuiPageSection>
      </EuiPageBody>
    </EuiPage>
  );
};
