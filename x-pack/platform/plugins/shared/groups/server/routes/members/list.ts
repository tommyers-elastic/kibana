/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import { createServerRoute } from '../create_server_route';

export const listMembersRoute = createServerRoute({
  endpoint: 'GET /internal/groups/{groupId}/members',
  options: {
    access: 'internal',
    summary: 'List all members of a group',
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
    query: z.object({
      assetType: z.string().optional(),
      page: z.coerce.number().min(1).default(1),
      perPage: z.coerce.number().min(1).max(100).default(20),
    }),
  }),
  handler: async ({ params, getScopedClients, request }) => {
    const { groupsClient, membersClient } = await getScopedClients({ request });
    const { groupId } = params.path;
    const { assetType, page, perPage } = params.query;
    
    // Validate that the group exists
    const group = await groupsClient.getGroup(groupId);
    if (!group) {
      throw new Error('Group not found');
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
