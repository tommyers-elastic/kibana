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
  EuiBasicTable,
  EuiSpacer,
  EuiText,
  EuiDescriptionList,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFlyout,
  EuiFlyoutHeader,
  EuiFlyoutBody,
  EuiFlyoutFooter,
  EuiTitle,
  EuiForm,
  EuiFormRow,
  EuiFieldText,
  EuiSelect,
  EuiEmptyPrompt,
  EuiLoadingSpinner,
  EuiCallOut,
} from '@elastic/eui';
import { useParams, useHistory } from 'react-router-dom';
import { useKibana } from '@kbn/kibana-react-plugin/public';
import type { CoreStart } from '@kbn/core/public';
import { GroupsAPIClient } from '../../services/api_client';
import type { Group, Member } from '../../../common/types';

const ASSET_TYPE_OPTIONS = [
  { value: 'dashboard', text: 'Dashboard' },
  { value: 'search', text: 'Saved Search' },
  { value: 'visualization', text: 'Visualization' },
  { value: 'lens', text: 'Lens' },
  { value: 'index-pattern', text: 'Data View' },
  { value: 'alert', text: 'Alert Rule' },
  { value: 'slo', text: 'SLO' },
  { value: 'stream', text: 'Stream' },
];

export const GroupDetail: React.FC = () => {
  const { groupId } = useParams<{ groupId: string }>();
  const history = useHistory();
  const { services } = useKibana<CoreStart>();
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [membersLoading, setMembersLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFlyoutVisible, setIsFlyoutVisible] = useState(false);
  const [newAssetType, setNewAssetType] = useState('dashboard');
  const [newAssetId, setNewAssetId] = useState('');
  const [addingMember, setAddingMember] = useState(false);

  const apiClient = React.useMemo(() => new GroupsAPIClient(services.http), [services.http]);

  const fetchGroup = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fetchedGroup = await apiClient.getGroup(groupId);
      setGroup(fetchedGroup);
    } catch (e) {
      setError(e.message || 'Failed to load group');
      services.notifications.toasts.addError(e, {
        title: 'Failed to load group',
      });
    } finally {
      setLoading(false);
    }
  }, [apiClient, groupId, services.notifications.toasts]);

  const fetchMembers = React.useCallback(async () => {
    setMembersLoading(true);
    try {
      const response = await apiClient.listMembers(groupId, { size: 100 });
      setMembers(response.members);
    } catch (e) {
      services.notifications.toasts.addError(e, {
        title: 'Failed to load group members',
      });
    } finally {
      setMembersLoading(false);
    }
  }, [apiClient, groupId, services.notifications.toasts]);

  useEffect(() => {
    fetchGroup();
    fetchMembers();
  }, [fetchGroup, fetchMembers]);

  const handleAddMember = async () => {
    if (!newAssetId.trim()) {
      services.notifications.toasts.addWarning({
        title: 'Asset ID is required',
      });
      return;
    }

    setAddingMember(true);
    try {
      await apiClient.addMember(groupId, {
        assetType: newAssetType,
        assetId: newAssetId.trim(),
      });
      services.notifications.toasts.addSuccess({
        title: 'Asset added to group',
      });
      setIsFlyoutVisible(false);
      setNewAssetId('');
      fetchMembers();
    } catch (e) {
      services.notifications.toasts.addError(e, {
        title: 'Failed to add asset',
      });
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveMember = async (member: Member) => {
    if (!window.confirm(`Remove ${member.assetType}:${member.assetId} from this group?`)) {
      return;
    }

    try {
      await apiClient.removeMember(groupId, member.assetType, member.assetId);
      services.notifications.toasts.addSuccess({
        title: 'Asset removed from group',
      });
      fetchMembers();
    } catch (e) {
      services.notifications.toasts.addError(e, {
        title: 'Failed to remove asset',
      });
    }
  };

  const handleDelete = async () => {
    if (
      !window.confirm(
        'Are you sure you want to delete this group? This will remove all member associations. This action cannot be undone.'
      )
    ) {
      return;
    }

    try {
      await apiClient.deleteGroup(groupId);
      services.notifications.toasts.addSuccess({
        title: 'Group deleted successfully',
      });
      history.push('/');
    } catch (e) {
      services.notifications.toasts.addError(e, {
        title: 'Failed to delete group',
      });
    }
  };

  const memberColumns = [
    {
      field: 'assetType' as const,
      name: 'Type',
      render: (assetType: string) => {
        const option = ASSET_TYPE_OPTIONS.find((opt) => opt.value === assetType);
        return option ? option.text : assetType;
      },
    },
    {
      field: 'assetId' as const,
      name: 'Asset ID',
      render: (assetId: string) => <EuiText size="s">{assetId}</EuiText>,
    },
    {
      field: 'addedAt' as const,
      name: 'Added',
      render: (addedAt: string) => new Date(addedAt).toLocaleString(),
    },
    {
      name: 'Actions',
      field: 'assetType' as const,
      actions: [
        {
          name: 'Remove',
          description: 'Remove from group',
          icon: 'trash',
          type: 'icon' as const,
          color: 'danger',
          onClick: handleRemoveMember,
        },
      ],
    },
  ];

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

  if (error || !group) {
    return (
      <EuiPage restrictWidth>
        <EuiPageBody>
          <EuiEmptyPrompt
            iconType="error"
            color="danger"
            title={<h2>Error loading group</h2>}
            body={<p>{error || 'Group not found'}</p>}
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

  const groupDetails = [
    {
      title: 'Name',
      description: group.name,
    },
    {
      title: 'Description',
      description: group.description || '—',
    },
    {
      title: 'Created',
      description: new Date(group.createdAt).toLocaleString(),
    },
    {
      title: 'Updated',
      description: new Date(group.updatedAt).toLocaleString(),
    },
    {
      title: 'Owner',
      description: group.owner,
    },
  ];

  return (
    <>
      <EuiPage restrictWidth>
        <EuiPageBody>
          <EuiPageHeader
            pageTitle={group.name}
            description={group.description}
            rightSideItems={[
              <EuiButton onClick={() => history.push(`/${groupId}/edit`)} iconType="pencil">
                Edit
              </EuiButton>,
              <EuiButton onClick={handleDelete} color="danger" iconType="trash">
                Delete
              </EuiButton>,
              <EuiButtonEmpty onClick={() => history.push('/')} iconType="arrowLeft">
                Back to groups
              </EuiButtonEmpty>,
            ]}
          />

          <EuiPageSection>
            <EuiTitle size="s">
              <h3>Details</h3>
            </EuiTitle>
            <EuiSpacer size="m" />
            <EuiDescriptionList listItems={groupDetails} />
          </EuiPageSection>

          <EuiPageSection>
            <EuiFlexGroup justifyContent="spaceBetween" alignItems="center">
              <EuiFlexItem grow={false}>
                <EuiTitle size="s">
                  <h3>Members ({members.length})</h3>
                </EuiTitle>
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiButton onClick={() => setIsFlyoutVisible(true)} iconType="plus" fill size="s">
                  Add asset
                </EuiButton>
              </EuiFlexItem>
            </EuiFlexGroup>
            <EuiSpacer />
            {members.length === 0 ? (
              <EuiEmptyPrompt
                iconType="folderOpen"
                title={<h3>No assets yet</h3>}
                body={<p>Add dashboards, rules, SLOs, and other assets to this group.</p>}
                actions={
                  <EuiButton onClick={() => setIsFlyoutVisible(true)} fill iconType="plus">
                    Add asset
                  </EuiButton>
                }
              />
            ) : (
              <EuiBasicTable items={members} columns={memberColumns} loading={membersLoading} />
            )}
          </EuiPageSection>
        </EuiPageBody>
      </EuiPage>

      {isFlyoutVisible && (
        <EuiFlyout onClose={() => setIsFlyoutVisible(false)} size="s">
          <EuiFlyoutHeader hasBorder>
            <EuiTitle size="m">
              <h2>Add asset to group</h2>
            </EuiTitle>
          </EuiFlyoutHeader>
          <EuiFlyoutBody>
            <EuiCallOut title="Asset validation" color="primary" iconType="iInCircle" size="s">
              <p>
                Groups do not validate that assets exist. Make sure to enter the correct asset ID.
              </p>
            </EuiCallOut>
            <EuiSpacer />
            <EuiForm>
              <EuiFormRow label="Asset type">
                <EuiSelect
                  options={ASSET_TYPE_OPTIONS}
                  value={newAssetType}
                  onChange={(e) => setNewAssetType(e.target.value)}
                />
              </EuiFormRow>
              <EuiFormRow
                label="Asset ID"
                helpText="Enter the unique identifier for the asset (e.g., dashboard ID, rule ID)"
              >
                <EuiFieldText
                  value={newAssetId}
                  onChange={(e) => setNewAssetId(e.target.value)}
                  placeholder="e.g., my-dashboard-id"
                />
              </EuiFormRow>
            </EuiForm>
          </EuiFlyoutBody>
          <EuiFlyoutFooter>
            <EuiFlexGroup justifyContent="spaceBetween">
              <EuiFlexItem grow={false}>
                <EuiButtonEmpty onClick={() => setIsFlyoutVisible(false)}>Cancel</EuiButtonEmpty>
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiButton onClick={handleAddMember} fill isLoading={addingMember}>
                  Add asset
                </EuiButton>
              </EuiFlexItem>
            </EuiFlexGroup>
          </EuiFlyoutFooter>
        </EuiFlyout>
      )}
    </>
  );
};
