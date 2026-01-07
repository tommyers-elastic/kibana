/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { StorageIndexAdapter } from '@kbn/storage-adapter';
import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import { v4 as uuidv4 } from 'uuid';
import { groupsStorageSettings } from './index_definitions';
import type {
  Group,
  CreateGroupParams,
  UpdateGroupParams,
  ListGroupsParams,
  PaginatedResponse,
} from '../../../common/types';

/**
 * Storage client for managing groups in Elasticsearch
 */
export class GroupsStorageClient {
  private adapter: StorageIndexAdapter<typeof groupsStorageSettings, Group>;

  constructor(esClient: ElasticsearchClient, logger: Logger) {
    this.adapter = new StorageIndexAdapter<typeof groupsStorageSettings, Group>(
      esClient,
      logger,
      groupsStorageSettings
    );
  }

  /**
   * Get the storage client
   */
  getClient() {
    return this.adapter.getClient();
  }

  /**
   * Create a new group
   */
  async createGroup(params: CreateGroupParams): Promise<Group> {
    const now = new Date().toISOString();
    const group: Group = {
      id: uuidv4(),
      name: params.name,
      description: params.description,
      owner: params.owner,
      permissions: {
        [params.owner]: 'admin',
      },
      metadata: params.metadata || {},
      createdAt: now,
      updatedAt: now,
    };

    const client = this.adapter.getClient();
    await client.index({ id: group.id, document: group });
    return group;
  }

  /**
   * Get a group by ID
   */
  async getGroup(id: string): Promise<Group | null> {
    const client = this.adapter.getClient();
    try {
      const result = await client.get({ id });
      return result._source ?? null;
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Update an existing group
   */
  async updateGroup(id: string, params: UpdateGroupParams): Promise<Group | null> {
    const existing = await this.getGroup(id);
    if (!existing) {
      return null;
    }

    const updated: Group = {
      ...existing,
      ...(params.name !== undefined && { name: params.name }),
      ...(params.description !== undefined && { description: params.description }),
      ...(params.metadata !== undefined && { metadata: params.metadata }),
      ...(params.permissions !== undefined && { permissions: params.permissions }),
      updatedAt: new Date().toISOString(),
    };

    const client = this.adapter.getClient();
    await client.index({ id, document: updated });
    return updated;
  }

  /**
   * Delete a group
   */
  async deleteGroup(id: string): Promise<boolean> {
    const existing = await this.getGroup(id);
    if (!existing) {
      return false;
    }

    const client = this.adapter.getClient();
    await client.delete({ id });
    return true;
  }

  /**
   * List groups with optional filtering and pagination
   */
  async listGroups(params: ListGroupsParams = {}): Promise<PaginatedResponse<Group>> {
    const { search, page = 1, perPage = 20, sortField = 'createdAt', sortOrder = 'desc' } = params;

    const from = (page - 1) * perPage;

    // Build query
    const query: any = {
      bool: {
        must: [],
      },
    };

    if (search) {
      query.bool.must.push({
        multi_match: {
          query: search,
          fields: ['name', 'description'],
          type: 'best_fields',
          fuzziness: 'AUTO',
        },
      });
    }

    // If no filters, match all
    if (query.bool.must.length === 0) {
      query.bool.must.push({ match_all: {} });
    }

    const client = this.adapter.getClient();
    const response = await client.search({
      query,
      sort: [{ [sortField]: { order: sortOrder } }],
      from,
      size: perPage,
      track_total_hits: true,
    });

    return {
      data: response.hits.hits.map((hit: { _source?: Group }) => hit._source as Group),
      total:
        typeof response.hits.total === 'number'
          ? response.hits.total
          : response.hits.total?.value || 0,
      page,
      perPage,
    };
  }

  /**
   * Find groups by owner
   */
  async findGroupsByOwner(owner: string): Promise<Group[]> {
    const client = this.adapter.getClient();
    const response = await client.search({
      query: {
        term: {
          owner,
        },
      },
      size: 10000, // TODO: Add pagination for large result sets
      track_total_hits: true,
    });

    return response.hits.hits.map((hit: { _source?: Group }) => hit._source as Group);
  }
}
