/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import { createServerRoute } from '../create_server_route';
import { GROUPS_API_PRIVILEGES } from '../../../common/constants';

export const getGroupRoute = createServerRoute({
  endpoint: 'GET /internal/groups/{id}',
  options: {
    access: 'internal',
    summary: 'Get a group by ID',
  },
  params: z.object({
    path: z.object({
      id: z.string(),
    }),
  }),
  handler: async ({ params, getScopedClients, request }) => {
    const { groupsClient } = await getScopedClients({ request });
    const group = await groupsClient.getGroup(params.path.id);

    if (!group) {
      throw new Error('Group not found');
    }

    return { group };
  },
});
