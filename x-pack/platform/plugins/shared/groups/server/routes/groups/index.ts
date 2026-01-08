/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createGroupRoute } from './create';
import { getGroupRoute } from './get';
import { listGroupsRoute } from './list';
import { updateGroupRoute } from './update';
import { deleteGroupRoute } from './delete';

export const groupsRoutes = {
  ...createGroupRoute,
  ...getGroupRoute,
  ...listGroupsRoute,
  ...updateGroupRoute,
  ...deleteGroupRoute,
};
