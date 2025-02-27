/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { schema } from '@kbn/config-schema';

import type { userActionApiV1 } from '../../../../common/types/api';
import { CASE_USER_ACTIONS_URL } from '../../../../common/constants';
import { createCaseError } from '../../../common/error';
import { createCasesRoute } from '../create_cases_route';

/**
 * @deprecated since version 8.1.0
 */
export const getUserActionsRoute = createCasesRoute({
  method: 'get',
  path: CASE_USER_ACTIONS_URL,
  params: {
    params: schema.object({
      case_id: schema.string(),
    }),
  },
  options: { deprecated: true },
  routerOptions: {
    access: 'public',
    description: `Get all user activity for a case`,
  },
  handler: async ({ context, request, response }) => {
    try {
      const caseContext = await context.cases;
      const casesClient = await caseContext.getCasesClient();
      const caseId = request.params.case_id;

      const res: userActionApiV1.CaseUserActionsDeprecatedResponse =
        await casesClient.userActions.getAll({ caseId });

      return response.ok({
        body: res,
      });
    } catch (error) {
      throw createCaseError({
        message: `Failed to retrieve case user actions in route case id: ${request.params.case_id}: ${error}`,
        error,
      });
    }
  },
});
