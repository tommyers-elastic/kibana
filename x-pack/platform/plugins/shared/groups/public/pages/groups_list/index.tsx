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
  EuiBasicTable,
  EuiLink,
  EuiFieldSearch,
  EuiSpacer,
  EuiText,
  EuiEmptyPrompt,
  EuiLoadingSpinner,
} from '@elastic/eui';
import { useHistory } from 'react-router-dom';
import { useKibana } from '@kbn/kibana-react-plugin/public';
import type { CoreStart } from '@kbn/core/public';
import { GroupsAPIClient } from '../../services/api_client';
import type { Group } from '../../../common/types';

export const GroupsList: React.FC = () => {
  const { services } = useKibana<CoreStart>();
  const history = useHistory();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [totalGroups, setTotalGroups] = useState(0);

  const apiClient = React.useMemo(() => new GroupsAPIClient(services.http), [services.http]);

  const fetchGroups = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.listGroups({
        from: pageIndex * pageSize,
        size: pageSize,
        search: searchValue || undefined,
      });
      setGroups(response.groups);
      setTotalGroups(response.total);
    } catch (e) {
      setError(e.message || 'Failed to load groups');
      services.notifications.toasts.addError(e, {
        title: 'Failed to load groups',
      });
    } finally {
      setLoading(false);
    }
  }, [apiClient, pageIndex, pageSize, searchValue, services.notifications.toasts]);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const handleDelete = async (groupId: string) => {
    if (
      !window.confirm('Are you sure you want to delete this group? This action cannot be undone.')
    ) {
      return;
    }

    try {
      await apiClient.deleteGroup(groupId);
      services.notifications.toasts.addSuccess({
        title: 'Group deleted successfully',
      });
      fetchGroups();
    } catch (e) {
      services.notifications.toasts.addError(e, {
        title: 'Failed to delete group',
      });
    }
  };

  const columns = [
    {
      field: 'name',
      name: 'Name',
      render: (name: string, group: Group) => (
        <EuiLink onClick={() => history.push(`/${group.id}`)}>
          <strong>{name}</strong>
        </EuiLink>
      ),
    },
    {
      field: 'description',
      name: 'Description',
      render: (description?: string) => <EuiText size="s">{description || '—'}</EuiText>,
    },
    {
      field: 'createdAt',
      name: 'Created',
      render: (createdAt: string) => new Date(createdAt).toLocaleDateString(),
    },
    {
      name: 'Actions',
      field: 'id' as const,
      actions: [
        {
          name: 'View',
          description: 'View group details',
          icon: 'eye',
          type: 'icon',
          onClick: (group: Group) => history.push(`/${group.id}`),
        },
        {
          name: 'Edit',
          description: 'Edit group',
          icon: 'pencil',
          type: 'icon',
          onClick: (group: Group) => history.push(`/${group.id}/edit`),
        },
        {
          name: 'Delete',
          description: 'Delete group',
          icon: 'trash',
          type: 'icon',
          color: 'danger',
          onClick: (group: Group) => handleDelete(group.id),
        },
      ],
    },
  ];

  const pagination = {
    pageIndex,
    pageSize,
    totalItemCount: totalGroups,
    pageSizeOptions: [10, 25, 50],
  };

  const onTableChange = ({ page }: { page?: { index: number; size: number } }) => {
    if (page) {
      setPageIndex(page.index);
      setPageSize(page.size);
    }
  };

  const renderContent = () => {
    if (error) {
      return (
        <EuiEmptyPrompt
          iconType="error"
          color="danger"
          title={<h2>Error loading groups</h2>}
          body={<p>{error}</p>}
          actions={
            <EuiButton onClick={fetchGroups} fill>
              Retry
            </EuiButton>
          }
        />
      );
    }

    if (loading && groups.length === 0) {
      return (
        <EuiEmptyPrompt icon={<EuiLoadingSpinner size="xl" />} title={<h2>Loading groups...</h2>} />
      );
    }

    if (groups.length === 0) {
      return (
        <EuiEmptyPrompt
          iconType="folderOpen"
          title={<h2>No groups yet</h2>}
          body={
            <p>
              Groups help you organize your dashboards, rules, SLOs, and other assets together.
              Create your first group to get started.
            </p>
          }
          actions={
            <EuiButton onClick={() => history.push('/create')} fill>
              Create group
            </EuiButton>
          }
        />
      );
    }

    return (
      <EuiBasicTable
        items={groups}
        columns={columns}
        pagination={pagination}
        onChange={onTableChange}
        loading={loading}
      />
    );
  };

  return (
    <EuiPage restrictWidth>
      <EuiPageBody>
        <EuiPageHeader
          pageTitle="Groups"
          description="Organize and manage your dashboards, rules, SLOs, and other assets"
          rightSideItems={[
            <EuiButton onClick={() => history.push('/create')} fill iconType="plus">
              Create group
            </EuiButton>,
          ]}
        />
        <EuiPageSection>
          <EuiFieldSearch
            placeholder="Search groups..."
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            isClearable
            fullWidth
          />
          <EuiSpacer />
          {renderContent()}
        </EuiPageSection>
      </EuiPageBody>
    </EuiPage>
  );
};
