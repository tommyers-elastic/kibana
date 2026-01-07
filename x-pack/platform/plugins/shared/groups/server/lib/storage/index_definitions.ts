/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { types } from '@kbn/storage-adapter';

/**
 * Index name for groups metadata
 */
export const GROUPS_INDEX_NAME = '.kibana_groups';

/**
 * Storage settings for groups index
 */
export const groupsStorageSettings = {
  name: GROUPS_INDEX_NAME,
  schema: {
    properties: {
      id: types.keyword(),
      name: types.text({ fields: { keyword: types.keyword() } }),
      description: types.text(),
      owner: types.keyword(),
      permissions: types.object({ dynamic: true }),
      metadata: types.object({ dynamic: true }),
      createdAt: types.date(),
      updatedAt: types.date(),
    },
  },
} as const;

/**
 * Index name for group membership (asset associations)
 */
export const MEMBERS_INDEX_NAME = '.kibana_groups_members';

/**
 * Storage settings for members index
 */
export const membersStorageSettings = {
  name: MEMBERS_INDEX_NAME,
  schema: {
    properties: {
      id: types.keyword(),
      groupId: types.keyword(),
      assetType: types.keyword(),
      assetId: types.keyword(),
      addedAt: types.date(),
      addedBy: types.keyword(),
    },
  },
} as const;
