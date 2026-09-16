/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { KibanaRequest, Logger } from '@kbn/core/server';
import type { EntityDefinitionRegistry, EntityDefinitionsClient } from '@kbn/entity-store/server';
import type { GetInventoryService } from '../routes/types';

/** Request-scoped dependencies of the agent builder tools; every factory is lazy so setup stays cheap. */
export interface AgentBuilderToolDeps {
  logger: Logger;
  /** Throws a Boom `forbidden` when the inventory ui setting is off; tools turn that into a result. */
  getInventoryService: GetInventoryService;
  /** Read side of the definitions for a space (internal repository; the tool user is already authorised by Agent Builder). */
  getDefinitionRegistry: (spaceId: string) => Promise<EntityDefinitionRegistry>;
  /** Write side over the request-scoped saved objects client; rejects when dynamic definitions are off. */
  getDefinitionsClient: (request: KibanaRequest) => Promise<EntityDefinitionsClient>;
}
