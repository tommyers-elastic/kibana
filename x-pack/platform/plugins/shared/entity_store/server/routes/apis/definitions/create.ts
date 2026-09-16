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
import { DefinitionBody } from './validator';

export function registerDefinitionsCreate(router: EntityStorePluginRouter) {
  router.versioned
    .post({
      path: ENTITY_DEFINITIONS_ROUTES.CREATE,
      access: 'internal',
      summary: 'Register an entity definition',
      description:
        'Registers a non-materialised entity definition (`type`) or an inventory extension of a built-in type ' +
        '(`{ extends, inventory }`) in the current space. Built-in type names are reserved for extensions.',
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
            body: buildStrictRouteValidationWithZod(DefinitionBody),
          },
        },
      },
      wrapDefinitionsMiddlewares<never, never, DefinitionBody>(
        async (ctx, req, res): Promise<IKibanaResponse> => {
          const { entityDefinitionsClient } = await ctx.entityStore;
          try {
            const record = await entityDefinitionsClient.create(req.body);
            return res.created({ body: record });
          } catch (error) {
            return mapDefinitionError(error, res) ?? Promise.reject(error);
          }
        }
      )
    );
}
