/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import { createServerRoute } from '../create_server_route';

export const addMemberRoute = createServerRoute({
  endpoint: 'POST /internal/groups/{groupId}/members',
  options: {
    access: 'internal',
    summary: 'Add a member (asset) to a group',
  },
  security: {
    authz: {
      enabled: false,
      reason: 'This route is opted out from authorization',
    },
  },
  params: z.object({
    path: z.object({
      groupId: z.string(),
    }),
    body: z.object({
      assetType: z.string().min(1),
      assetId: z.string().min(1),
    }),
  }),
  handler: async ({ params, getScopedClients, request }) => {
    const { groupsClient, membersClient } = await getScopedClients({ request });
    const { groupId } = params.path;
    const { assetType, assetId } = params.body;
    
    // Validate that the group exists
    const group = await groupsClient.getGroup(groupId);
    if (!group) {
      throw new Error('Group not found');
    }

    // Note: For now, set addedBy to 'system'. In a future PR, we can integrate
    // with the security plugin to get the actual authenticated user.
    const userId = 'system';

    const member = await membersClient.addMember({
      groupId,
      assetType,
      assetId,
      addedBy: userId,
    });

    return { member };
  },
});
