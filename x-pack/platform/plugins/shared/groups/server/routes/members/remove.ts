/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import { createServerRoute } from '../create_server_route';
import { GROUPS_PRIVILEGES } from '../../lib/features';

export const removeMemberRoute = createServerRoute({
  endpoint: 'DELETE /internal/groups/{groupId}/members/{assetType}/{assetId}',
  options: {
    access: 'internal',
    summary: 'Remove a member (asset) from a group',
  },
  security: {
    authz: {
      requiredPrivileges: [GROUPS_PRIVILEGES.MANAGE_GROUP],
    },
  },
  params: z.object({
    path: z.object({
      groupId: z.string(),
      assetType: z.string(),
      assetId: z.string(),
    }),
  }),
  handler: async ({ params, getScopedClients, request, response }) => {
    const { groupsClient, membersClient, aclService } = await getScopedClients({ request });
    const { groupId, assetType, assetId } = params.path;

    // Validate that the group exists
    const group = await groupsClient.getGroup(groupId);
    if (!group) {
      throw new Error('Group not found');
    }

    // Check per-group ACL
    const canWrite = await aclService.canWrite(request, group);
    if (!canWrite) {
      return response.forbidden({
        body: { message: 'Insufficient permissions to remove members from this group' },
      });
    }

    const removed = await membersClient.removeMember(groupId, assetType, assetId);

    if (!removed) {
      throw new Error('Member not found');
    }

    return { success: true };
  },
});
