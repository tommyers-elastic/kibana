/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import { createServerRoute } from '../create_server_route';
import { GROUPS_API_PRIVILEGES } from '../../../common/constants';

export const updateGroupRoute = createServerRoute({
  endpoint: 'PUT /api/groups/{id} 2023-10-31',
  options: {
    access: 'public',
    summary: 'Update a group',
  },
  security: {
    authz: {
      requiredPrivileges: [GROUPS_API_PRIVILEGES.manage],
    },
  },
  params: z.object({
    path: z.object({
      id: z.string(),
    }),
    body: z.object({
      name: z.string().min(1).max(255).optional(),
      description: z.string().max(1000).optional(),
      metadata: z.record(z.unknown()).optional(),
    }),
  }),
  handler: async ({ params, getScopedClients, request }) => {
    const { groupsClient } = await getScopedClients({ request });
    const group = await groupsClient.getGroup(params.path.id);

    if (!group) {
      throw new Error('Group not found');
    }

    const updated = await groupsClient.updateGroup(params.path.id, params.body);
    if (!updated) {
      throw new Error('Failed to update group');
    }
    return { group: updated };
  },
});
