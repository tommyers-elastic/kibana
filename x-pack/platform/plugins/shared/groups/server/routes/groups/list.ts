/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import { createServerRoute } from '../create_server_route';
import { GROUPS_API_PRIVILEGES } from '../../../common/constants';

export const listGroupsRoute = createServerRoute({
  endpoint: 'GET /api/groups 2023-10-31',
  options: {
    access: 'public',
    summary: 'List or search groups',
  },
  security: {
    authz: {
      requiredPrivileges: [GROUPS_API_PRIVILEGES.read],
    },
  },
  params: z.object({
    query: z.object({
      name: z.string().optional(),
      from: z.coerce.number().optional(),
      size: z.coerce.number().optional(),
    }),
  }),
  handler: async ({ params, getScopedClients, request }) => {
    const { groupsClient } = await getScopedClients({ request });
    const result = await groupsClient.listGroups({
      search: params.query.name,
      page: params.query.from !== undefined ? Math.floor(params.query.from / (params.query.size || 20)) + 1 : 1,
      perPage: params.query.size,
    });

    return {
      groups: result.data,
      total: result.total,
    };
  },
});
