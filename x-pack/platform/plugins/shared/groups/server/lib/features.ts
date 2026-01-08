/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { FeaturesPluginSetup } from '@kbn/features-plugin/server';
import { PLUGIN_ID } from '../../common/constants';

export const GROUPS_FEATURE_ID = 'groups';

export const GROUPS_PRIVILEGES = {
  READ_GROUP: 'read_group',
  MANAGE_GROUP: 'manage_group',
} as const;

export function registerGroupsFeature(features: FeaturesPluginSetup) {
  features.registerKibanaFeature({
    id: GROUPS_FEATURE_ID,
    name: 'Groups',
    category: { id: 'management', label: 'Management' },
    app: [PLUGIN_ID],
    catalogue: [PLUGIN_ID],
    privileges: {
      all: {
        app: [PLUGIN_ID],
        catalogue: [PLUGIN_ID],
        api: [GROUPS_PRIVILEGES.READ_GROUP, GROUPS_PRIVILEGES.MANAGE_GROUP],
        savedObject: {
          all: [],
          read: [],
        },
        ui: ['show', 'manage'],
      },
      read: {
        app: [PLUGIN_ID],
        catalogue: [PLUGIN_ID],
        api: [GROUPS_PRIVILEGES.READ_GROUP],
        savedObject: {
          all: [],
          read: [],
        },
        ui: ['show'],
      },
    },
  });
}
