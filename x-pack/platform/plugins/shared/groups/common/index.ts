/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

export const PLUGIN_ID = 'groups';
export const PLUGIN_NAME = 'Groups';

export {
  GROUPS_FEATURE_ID,
  GROUPS_API_PRIVILEGES,
  GROUPS_UI_PRIVILEGES,
  ACL_ACCESS_LEVELS,
} from './constants';
export type { ACLAccessLevel } from './constants';

export type {
  ACLAccessLevel,
  GroupACL,
  Group,
  CreateGroupParams,
  UpdateGroupParams,
  Member,
  AddMemberParams,
  ListGroupsParams,
  ListMembersParams,
  PaginatedResponse,
} from './types';

export { ACL_ACCESS_LEVELS } from './types';
