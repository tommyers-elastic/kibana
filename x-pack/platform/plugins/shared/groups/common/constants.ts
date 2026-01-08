/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

export const GROUPS_FEATURE_ID = 'groups';

export const GROUPS_API_PRIVILEGES = {
  read: 'read_group',
  manage: 'manage_group',
} as const;

export const GROUPS_UI_PRIVILEGES = {
  show: 'show',
  manage: 'manage',
} as const;

export const ACL_ACCESS_LEVELS = ['read', 'write', 'admin'] as const;
export type ACLAccessLevel = (typeof ACL_ACCESS_LEVELS)[number];
