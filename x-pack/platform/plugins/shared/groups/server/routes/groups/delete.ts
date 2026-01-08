/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import { createServerRoute } from '../create_server_route';
import { GROUPS_PRIVILEGES } from '../../lib/features';

export const deleteGroupRoute = createServerRoute({
  endpoint: 'DELETE /internal/groups/{id}',
  options: {
    access: 'internal',
    summary: 'Delete a group',
  },
  security: {
    authz: {
      requiredPrivileges: [GROUPS_PRIVILEGES.MANAGE_GROUP],
    },
  },
  params: z.object({
    path: z.object({
      id: z.string(),
    }),
  }),
  handler: async ({ params, getScopedClients, request, response }) => {
    const { groupsClient, membersClient, aclService } = await getScopedClients({ request });
    const group = await groupsClient.getGroup(params.path.id);

    if (!group) {
      throw new Error('Group not found');
    }

    // Check per-group ACL
    const canDelete = await aclService.canDelete(request, group);
    if (!canDelete) {
      return response.forbidden({
        body: { message: 'Insufficient permissions to delete this group' },
      });
    }

    // Remove all members first
    await membersClient.deleteGroupMembers(params.path.id);

    // Delete the group
    await groupsClient.deleteGroup(params.path.id);

    return { success: true };
  },
});
