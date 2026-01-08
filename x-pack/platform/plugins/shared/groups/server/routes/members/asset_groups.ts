/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import { createServerRoute } from '../create_server_route';
import { GROUPS_PRIVILEGES } from '../../lib/features';

export const assetGroupsRoute = createServerRoute({
  endpoint: 'GET /internal/groups/by-asset/{assetType}/{assetId}',
  options: {
    access: 'internal',
    summary: 'Get all groups that contain a specific asset',
  },
  security: {
    authz: {
      requiredPrivileges: [GROUPS_PRIVILEGES.READ_GROUP],
    },
  },
  params: z.object({
    path: z.object({
      assetType: z.string(),
      assetId: z.string(),
    }),
  }),
  handler: async ({ params, getScopedClients, request }) => {
    const { membersClient } = await getScopedClients({ request });
    const { assetType, assetId } = params.path;

    const members = await membersClient.getMemberGroups(assetType, assetId);

    return { groups: members };
  },
});
