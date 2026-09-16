/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { IKibanaResponse } from '@kbn/core-http-server';
import {
  API_VERSIONS,
  ENTITY_DEFINITIONS_API_PRIVILEGES,
  ENTITY_DEFINITIONS_ROUTES,
} from '../../../../common';
import type { EntityStorePluginRouter } from '../../../types';
import { wrapDefinitionsMiddlewares } from '../../middleware';
import { buildStrictRouteValidationWithZod } from '../utils/build_strict_route_validation';
import { ListDefinitionsQuery } from './validator';

export function registerDefinitionsList(router: EntityStorePluginRouter) {
  router.versioned
    .get({
      path: ENTITY_DEFINITIONS_ROUTES.LIST,
      access: 'internal',
      summary: 'List entity definitions',
      description:
        'Lists every entity definition resolvable in the current space (built-in, code-registered and API-registered), optionally filtered by materialisation mode or to those with an inventory extension.',
      security: {
        authz: { requiredPrivileges: [ENTITY_DEFINITIONS_API_PRIVILEGES.read] },
      },
      enableQueryVersion: true,
    })
    .addVersion(
      {
        version: API_VERSIONS.internal.v2,
        validate: {
          request: {
            query: buildStrictRouteValidationWithZod(ListDefinitionsQuery),
          },
        },
      },
      wrapDefinitionsMiddlewares<never, ListDefinitionsQuery, never>(
        async (ctx, req, res): Promise<IKibanaResponse> => {
          const { entityDefinitionRegistry } = await ctx.entityStore;
          const definitions = await entityDefinitionRegistry.getDefinitions({
            mode: req.query.mode,
            inventory: req.query.inventory,
          });
          return res.ok({ body: { definitions } });
        }
      )
    );
}
