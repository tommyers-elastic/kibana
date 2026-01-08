/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import { createServerRoute } from '../create_server_route';

export const removeMemberRoute = createServerRoute({
  endpoint: 'DELETE /internal/groups/{groupId}/members/{assetType}/{assetId}',
  options: {
    access: 'internal',
    summary: 'Remove a member (asset) from a group',
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
      assetType: z.string(),
      assetId: z.string(),
    }),
  }),
  handler: async ({ params, getScopedClients, request }) => {
    const { membersClient } = await getScopedClients({ request });
    const { groupId, assetType, assetId } = params.path;
    
    const removed = await membersClient.removeMember(groupId, assetType, assetId);
    
    if (!removed) {
      throw new Error('Member not found');
    }

    return { success: true };
  },
});
