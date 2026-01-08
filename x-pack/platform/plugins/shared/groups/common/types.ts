/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * Permission levels for group access control
 */
export const ACL_ACCESS_LEVELS = ['read', 'write', 'admin'] as const;
export type ACLAccessLevel = (typeof ACL_ACCESS_LEVELS)[number];

/**
 * Permission entry for a principal (user or role)
 */
export interface PermissionEntry {
  /** Principal identifier (username or role name) */
  principal: string;
  /** Type of principal */
  principalType: 'user' | 'role';
  /** Access level granted */
  accessLevel: ACLAccessLevel;
}

/**
 * Core group entity
 */
export interface Group {
  /** Unique identifier for the group */
  id: string;
  /** Display name of the group */
  name: string;
  /** Optional description of the group's purpose */
  description?: string;
  /** User ID who created the group */
  owner: string;
  /** Access control list for the group */
  permissions?: PermissionEntry[];
  /** Additional metadata (flexible key-value pairs) */
  metadata?: Record<string, unknown>;
  /** Timestamp when the group was created */
  createdAt: string;
  /** Timestamp when the group was last updated */
  updatedAt: string;
}

/**
 * Parameters for creating a new group
 */
export interface CreateGroupParams {
  /** Display name of the group */
  name: string;
  /** Optional description */
  description?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
  /** User ID creating the group */
  owner: string;
}

/**
 * Parameters for updating an existing group
 */
export interface UpdateGroupParams {
  /** Updated display name */
  name?: string;
  /** Updated description */
  description?: string;
  /** Updated metadata (replaces existing) */
  metadata?: Record<string, unknown>;
  /** Updated permissions (replaces existing) */
  permissions?: PermissionEntry[];
}

/**
 * Member of a group (asset association)
 */
export interface Member {
  /** Unique identifier for the membership record */
  id: string;
  /** ID of the group this member belongs to */
  groupId: string;
  /** Type of asset (dashboard, rule, slo, stream, etc.) */
  assetType: string;
  /** ID of the asset */
  assetId: string;
  /** Timestamp when the asset was added to the group */
  addedAt: string;
  /** User ID who added the asset */
  addedBy: string;
}

/**
 * Parameters for adding a member to a group
 */
export interface AddMemberParams {
  /** ID of the group */
  groupId: string;
  /** Type of asset to add */
  assetType: string;
  /** ID of the asset to add */
  assetId: string;
  /** User ID adding the member */
  addedBy: string;
}

/**
 * Query parameters for listing groups
 */
export interface ListGroupsParams {
  /** Search term for group name */
  search?: string;
  /** Page number (1-based) */
  page?: number;
  /** Number of results per page */
  perPage?: number;
  /** Field to sort by */
  sortField?: 'name' | 'createdAt' | 'updatedAt';
  /** Sort order */
  sortOrder?: 'asc' | 'desc';
}

/**
 * Query parameters for listing members
 */
export interface ListMembersParams {
  /** ID of the group */
  groupId: string;
  /** Filter by asset type */
  assetType?: string;
  /** Page number (1-based) */
  page?: number;
  /** Number of results per page */
  perPage?: number;
}

/**
 * Paginated response for list queries
 */
export interface PaginatedResponse<T> {
  /** Array of results */
  data: T[];
  /** Total number of results */
  total: number;
  /** Current page number */
  page: number;
  /** Number of results per page */
  perPage: number;
}
