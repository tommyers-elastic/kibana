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
import { DefinitionBody, DefinitionTypeParams, ReplaceDefinitionQuery } from './validator';

export function registerDefinitionsReplace(router: EntityStorePluginRouter) {
  router.versioned
    .put({
      path: ENTITY_DEFINITIONS_ROUTES.REPLACE,
      access: 'internal',
      summary: 'Replace an entity definition',
      description:
        'Replaces a registered entity definition. A change of identity is rejected unless `force=true`, ' +
        'because entity ids derived under the previous identity are no longer comparable. With an ' +
        '`{ extends, inventory }` body, creates or replaces the inventory extension of the built-in type.',
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
            query: buildStrictRouteValidationWithZod(ReplaceDefinitionQuery),
            body: buildStrictRouteValidationWithZod(DefinitionBody),
          },
        },
      },
      wrapDefinitionsMiddlewares<DefinitionTypeParams, ReplaceDefinitionQuery, DefinitionBody>(
        async (ctx, req, res): Promise<IKibanaResponse> => {
          const { entityDefinitionsClient } = await ctx.entityStore;
          try {
            const record = await entityDefinitionsClient.replace(req.params.type, req.body, {
              force: req.query.force ?? false,
            });
            return res.ok({ body: record });
          } catch (error) {
            return mapDefinitionError(error, res) ?? Promise.reject(error);
          }
        }
      )
    );
}
