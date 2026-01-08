/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import { createServerRoute } from '../create_server_route';
import { GROUPS_PRIVILEGES } from '../../lib/features';

export const listMembersRoute = createServerRoute({
  endpoint: 'GET /internal/groups/{groupId}/members',
  options: {
    access: 'internal',
    summary: 'List all members of a group',
  },
  security: {
    authz: {
      requiredPrivileges: [GROUPS_PRIVILEGES.READ_GROUP],
    },
  },
  params: z.object({
    path: z.object({
      groupId: z.string(),
    }),
    query: z.object({
      assetType: z.string().optional(),
      page: z.coerce.number().min(1).default(1),
      perPage: z.coerce.number().min(1).max(100).default(20),
    }),
  }),
  handler: async ({ params, getScopedClients, request, response }) => {
    const { groupsClient, membersClient, aclService } = await getScopedClients({ request });
    const { groupId } = params.path;
    const { assetType, page, perPage } = params.query;

    // Validate that the group exists
    const group = await groupsClient.getGroup(groupId);
    if (!group) {
      throw new Error('Group not found');
    }

    // Check per-group ACL
    const canRead = await aclService.canRead(request, group);
    if (!canRead) {
      return response.forbidden({
        body: { message: 'Insufficient permissions to read this group' },
      });
    }

    const result = await membersClient.getMembers({
      groupId,
      assetType,
      page,
      perPage,
    });

    return result;
  },
});
