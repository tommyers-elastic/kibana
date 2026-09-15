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
import { DefinitionTypeParams } from './validator';

export function registerDefinitionsGet(router: EntityStorePluginRouter) {
  router.versioned
    .get({
      path: ENTITY_DEFINITIONS_ROUTES.GET,
      access: 'internal',
      summary: 'Get an entity definition',
      description:
        'Returns a built-in, code-registered or API-registered entity definition resolvable in the current space.',
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
            params: buildStrictRouteValidationWithZod(DefinitionTypeParams),
          },
        },
      },
      wrapDefinitionsMiddlewares<DefinitionTypeParams, never, never>(
        async (ctx, req, res): Promise<IKibanaResponse> => {
          const { entityDefinitionRegistry, namespace } = await ctx.entityStore;
          const record = await entityDefinitionRegistry.getDefinition(req.params.type);
          if (!record) {
            return res.notFound({
              body: {
                message: `No entity definition of type "${req.params.type}" in space "${namespace}"`,
              },
            });
          }
          return res.ok({ body: record });
        }
      )
    );
}
