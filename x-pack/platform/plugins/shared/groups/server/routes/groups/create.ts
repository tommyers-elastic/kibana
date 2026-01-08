/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import { createServerRoute } from '../create_server_route';
import { GROUPS_API_PRIVILEGES } from '../../../common/constants';

export const createGroupRoute = createServerRoute({
  endpoint: 'POST /internal/groups',
  options: {
    access: 'internal',
    summary: 'Create a new group',
  },
  security: {
    authz: {
      enabled: false,
    },
  },
  params: z.object({
    body: z.object({
      name: z.string().min(1).max(255),
      description: z.string().max(1000).optional(),
      metadata: z.record(z.unknown()).optional(),
    }),
  }),
  handler: async ({ params, getScopedClients, request }) => {
    const { groupsClient } = await getScopedClients({ request });
    const { name, description, metadata } = params.body;
    
    // Note: For now, set owner to 'system'. In a future PR, we can integrate
    // with the security plugin to get the actual authenticated user.
    const userId = 'system';

    const group = await groupsClient.createGroup({
      name,
      description,
      metadata,
      owner: userId,
    });

    return { group };
  },
});
