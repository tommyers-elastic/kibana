/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { StorageIndexAdapter } from '@kbn/storage-adapter';
import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import { v4 as uuidv4 } from 'uuid';
import { membersStorageSettings } from './index_definitions';
import type {
  Member,
  AddMemberParams,
  ListMembersParams,
  PaginatedResponse,
} from '../../../common/types';

/**
 * Storage client for managing group membership in Elasticsearch
 */
export class MembersStorageClient {
  private adapter: StorageIndexAdapter<typeof membersStorageSettings, Member>;

  constructor(esClient: ElasticsearchClient, logger: Logger) {
    this.adapter = new StorageIndexAdapter<typeof membersStorageSettings, Member>(
      esClient,
      logger,
      membersStorageSettings
    );
  }

  /**
   * Get the storage client
   */
  getClient() {
    return this.adapter.getClient();
  }

  /**
   * Add a member to a group
   */
  async addMember(params: AddMemberParams): Promise<Member> {
    // Check if member already exists
    const existing = await this.findMember(params.groupId, params.assetType, params.assetId);
    if (existing) {
      return existing;
    }

    const member: Member = {
      id: uuidv4(),
      groupId: params.groupId,
      assetType: params.assetType,
      assetId: params.assetId,
      addedAt: new Date().toISOString(),
      addedBy: params.addedBy,
    };

    const client = this.adapter.getClient();
    await client.index({ id: member.id, document: member });
    return member;
  }

  /**
   * Remove a member from a group
   */
  async removeMember(groupId: string, assetType: string, assetId: string): Promise<boolean> {
    const member = await this.findMember(groupId, assetType, assetId);
    if (!member) {
      return false;
    }

    const client = this.adapter.getClient();
    await client.delete({ id: member.id });
    return true;
  }

  /**
   * Find a specific member by group, asset type, and asset ID
   */
  private async findMember(
    groupId: string,
    assetType: string,
    assetId: string
  ): Promise<Member | null> {
    const client = this.adapter.getClient();
    const response = await client.search({
      query: {
        bool: {
          must: [{ term: { groupId } }, { term: { assetType } }, { term: { assetId } }],
        },
      },
      size: 1,
      track_total_hits: true,
    });

    return response.hits.hits.length > 0 ? (response.hits.hits[0]._source as Member) : null;
  }

  /**
   * Get all members of a group with pagination
   */
  async getMembers(params: ListMembersParams): Promise<PaginatedResponse<Member>> {
    const { groupId, assetType, page = 1, perPage = 20 } = params;
    const from = (page - 1) * perPage;

    const must: any[] = [{ term: { groupId } }];

    if (assetType) {
      must.push({ term: { assetType } });
    }

    const client = this.adapter.getClient();
    const response = await client.search({
      query: {
        bool: {
          must,
        },
      },
      sort: [{ addedAt: { order: 'desc' } }],
      from,
      size: perPage,
      track_total_hits: true,
    });

    return {
      data: response.hits.hits.map((hit: { _source?: Member }) => hit._source as Member),
      total:
        typeof response.hits.total === 'number'
          ? response.hits.total
          : response.hits.total?.value || 0,
      page,
      perPage,
    };
  }

  /**
   * Get all groups an asset belongs to
   */
  async getMemberGroups(assetType: string, assetId: string): Promise<Member[]> {
    const client = this.adapter.getClient();
    const response = await client.search({
      query: {
        bool: {
          must: [{ term: { assetType } }, { term: { assetId } }],
        },
      },
      size: 10000, // TODO: Add pagination for large result sets
      track_total_hits: true,
    });

    return response.hits.hits.map((hit: { _source?: Member }) => hit._source as Member);
  }

  /**
   * Delete all members of a group (used when deleting a group)
   */
  async deleteGroupMembers(groupId: string): Promise<number> {
    const client = this.adapter.getClient();
    const response = await client.search({
      query: {
        term: { groupId },
      },
      size: 10000, // TODO: Use scroll API for large groups
      track_total_hits: true,
    });

    const members = response.hits.hits.map((hit: { _source?: Member }) => hit._source as Member);

    // Delete all members
    await Promise.all(members.map((member: Member) => client.delete({ id: member.id })));

    return members.length;
  }

  /**
   * Bulk add members to a group
   */
  async bulkAddMembers(
    groupId: string,
    assets: Array<{ assetType: string; assetId: string }>,
    addedBy: string
  ): Promise<Member[]> {
    const members: Member[] = [];

    for (const asset of assets) {
      const member = await this.addMember({
        groupId,
        assetType: asset.assetType,
        assetId: asset.assetId,
        addedBy,
      });
      members.push(member);
    }

    return members;
  }
}
