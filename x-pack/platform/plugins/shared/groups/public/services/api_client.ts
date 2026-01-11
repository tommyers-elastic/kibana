/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { HttpSetup } from '@kbn/core/public';
import type { Group, Member } from '../../common/types';

export interface PaginationParams {
  from?: number;
  size?: number;
}

export interface ListGroupsResponse {
  groups: Group[];
  total: number;
}

export interface ListMembersResponse {
  members: Member[];
  total: number;
}

export interface FindGroupsByAssetResponse {
  groups: Group[];
}

export interface CreateGroupParams {
  name: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateGroupParams {
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface AddMemberParams {
  assetType: string;
  assetId: string;
}

export class GroupsAPIClient {
  constructor(private readonly http: HttpSetup) {}

  // Group CRUD operations
  async createGroup(params: CreateGroupParams): Promise<Group> {
    const response = await this.http.post<{ group: Group }>('/internal/groups', {
      body: JSON.stringify(params),
    });
    return response.group;
  }

  async getGroup(groupId: string): Promise<Group> {
    const response = await this.http.get<{ group: Group }>(`/internal/groups/${groupId}`);
    return response.group;
  }

  async listGroups(params?: PaginationParams & { search?: string }): Promise<ListGroupsResponse> {
    const query: Record<string, string> = {};
    if (params?.from !== undefined) query.from = String(params.from);
    if (params?.size !== undefined) query.size = String(params.size);
    if (params?.search) query.search = params.search;

    return this.http.get<ListGroupsResponse>('/internal/groups', {
      query,
    });
  }

  async updateGroup(groupId: string, params: UpdateGroupParams): Promise<Group> {
    const response = await this.http.put<{ group: Group }>(`/internal/groups/${groupId}`, {
      body: JSON.stringify(params),
    });
    return response.group;
  }

  async deleteGroup(groupId: string): Promise<void> {
    await this.http.delete(`/internal/groups/${groupId}`);
  }

  // Membership operations
  async addMember(groupId: string, params: AddMemberParams): Promise<Member> {
    const response = await this.http.post<{ member: Member }>(
      `/internal/groups/${groupId}/members`,
      {
        body: JSON.stringify(params),
      }
    );
    return response.member;
  }

  async listMembers(
    groupId: string,
    params?: PaginationParams & { assetType?: string }
  ): Promise<ListMembersResponse> {
    const query: Record<string, string> = {};
    if (params?.from !== undefined) query.from = String(params.from);
    if (params?.size !== undefined) query.size = String(params.size);
    if (params?.assetType) query.assetType = params.assetType;

    return this.http.get<ListMembersResponse>(`/internal/groups/${groupId}/members`, {
      query,
    });
  }

  async removeMember(groupId: string, assetType: string, assetId: string): Promise<void> {
    await this.http.delete(`/internal/groups/${groupId}/members/${assetType}/${assetId}`);
  }

  async findGroupsByAsset(assetType: string, assetId: string): Promise<FindGroupsByAssetResponse> {
    return this.http.get<FindGroupsByAssetResponse>(
      `/internal/groups/by-asset/${assetType}/${assetId}`
    );
  }
}
