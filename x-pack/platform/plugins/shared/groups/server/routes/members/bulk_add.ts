/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import { createServerRoute } from '../create_server_route';
import { GROUPS_PRIVILEGES } from '../../lib/features';

export const bulkAddMembersRoute = createServerRoute({
  endpoint: 'POST /internal/groups/{groupId}/members/_bulk',
  options: {
    access: 'internal',
    summary: 'Add multiple members (assets) to a group',
  },
  security: {
    authz: {
      requiredPrivileges: [GROUPS_PRIVILEGES.MANAGE_GROUP],
    },
  },
  params: z.object({
    path: z.object({
      groupId: z.string(),
    }),
    body: z.object({
      members: z.array(
        z.object({
          assetType: z.string().min(1),
          assetId: z.string().min(1),
        })
      ),
    }),
  }),
  handler: async ({ params, getScopedClients, request, response }) => {
    const { groupsClient, membersClient, aclService } = await getScopedClients({ request });
    const { groupId } = params.path;
    const { members } = params.body;

    // Validate that the group exists
    const group = await groupsClient.getGroup(groupId);
    if (!group) {
      throw new Error('Group not found');
    }

    // Check per-group ACL
    const canWrite = await aclService.canWrite(request, group);
    if (!canWrite) {
      return response.forbidden({
        body: { message: 'Insufficient permissions to add members to this group' },
      });
    }

    // Get the authenticated user
    const userId = aclService.getCurrentUser(request) ?? 'system';

    // Add each member, collecting results
    const results = await Promise.allSettled(
      members.map(async ({ assetType, assetId }) => {
        const member = await membersClient.addMember({
          groupId,
          assetType,
          assetId,
          addedBy: userId,
        });
        return { assetType, assetId, success: true, member };
      })
    );

    // Transform results into success/failure format
    const responseResults = results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          assetType: members[index].assetType,
          assetId: members[index].assetId,
          success: false,
          error: result.reason?.message || 'Unknown error',
        };
      }
    });

    return { results: responseResults };
  },
});
