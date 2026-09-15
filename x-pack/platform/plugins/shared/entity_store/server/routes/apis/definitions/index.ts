/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { EntityStorePluginRouter } from '../../../types';
import { registerDefinitionsCreate } from './create';
import { registerDefinitionsDelete } from './delete';
import { registerDefinitionsGet } from './get';
import { registerDefinitionsList } from './list';
import { registerDefinitionsReplace } from './replace';

export function registerDefinitionsRoutes(router: EntityStorePluginRouter) {
  registerDefinitionsList(router);
  registerDefinitionsCreate(router);
  registerDefinitionsGet(router);
  registerDefinitionsReplace(router);
  registerDefinitionsDelete(router);
}
