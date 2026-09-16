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
import { mapDefinitionError } from './errors';
import { DefinitionTypeParams } from './validator';

export function registerDefinitionsDelete(router: EntityStorePluginRouter) {
  router.versioned
    .delete({
      path: ENTITY_DEFINITIONS_ROUTES.DELETE,
      access: 'internal',
      summary: 'Delete an entity definition',
      description:
        'Deletes an API-registered entity definition or, for a built-in type, its API-registered inventory extension. ' +
        'Built-in and code-registered types themselves cannot be deleted.',
      security: {
        authz: { requiredPrivileges: [ENTITY_DEFINITIONS_API_PRIVILEGES.manage] },
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
          const { entityDefinitionsClient } = await ctx.entityStore;
          try {
            await entityDefinitionsClient.delete(req.params.type);
            return res.ok({ body: { ok: true } });
          } catch (error) {
            return mapDefinitionError(error, res) ?? Promise.reject(error);
          }
        }
      )
    );
}
