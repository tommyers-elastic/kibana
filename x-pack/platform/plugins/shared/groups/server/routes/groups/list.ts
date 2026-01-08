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
  endpoint: 'GET /internal/groups',
  options: {
    access: 'internal',
    summary: 'List or search groups',
  },  security: {
    authz: {
      enabled: false,
      reason: 'This route is opted out from authorization',
    },
  },  params: z.object({
    query: z
      .object({
        name: z.string().optional(),
        from: z.coerce.number().optional(),
        size: z.coerce.number().optional(),
      })
      .optional()
      .default({}),
  }),
  handler: async ({ params, getScopedClients, request }) => {
    const { groupsClient } = await getScopedClients({ request });
    const query = params.query || {};
    const result = await groupsClient.listGroups({
      search: query.name,
      page: query.from !== undefined ? Math.floor(query.from / (query.size || 20)) + 1 : 1,
      perPage: query.size,
    });

    return {
      groups: result.data,
      total: result.total,
    };
  },
});
