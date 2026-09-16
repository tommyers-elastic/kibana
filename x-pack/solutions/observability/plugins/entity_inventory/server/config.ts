/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { schema, type TypeOf } from '@kbn/config-schema';
import type { PluginConfigDescriptor } from '@kbn/core/server';

const configSchema = schema.object({
  enabled: schema.boolean({ defaultValue: true }),
  /** Seconds to cache a source pattern's index modes and field capabilities. */
  sourceMetadataCacheTtlSeconds: schema.number({ defaultValue: 60, min: 0, max: 3600 }),
});

export type EntityInventoryConfig = TypeOf<typeof configSchema>;

export const config: PluginConfigDescriptor<EntityInventoryConfig> = {
  schema: configSchema,
};
