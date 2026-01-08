/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { groupsRoutes } from './groups';
import {
  addMemberRoute,
  removeMemberRoute,
  listMembersRoute,
  assetGroupsRoute,
  bulkAddMembersRoute,
} from './members';

export const groupsRouteRepository = {
  ...groupsRoutes,
  ...addMemberRoute,
  ...removeMemberRoute,
  ...listMembersRoute,
  ...assetGroupsRoute,
  ...bulkAddMembersRoute,
};

export type GroupsRouteRepository = typeof groupsRouteRepository;
