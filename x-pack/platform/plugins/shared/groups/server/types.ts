/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { FeaturesPluginSetup } from '@kbn/features-plugin/server';
import type { SecurityPluginSetup } from '@kbn/security-plugin-types-server';
import type { SpacesPluginSetup } from '@kbn/spaces-plugin/server';

export interface GroupsPluginSetupDeps {
  features: FeaturesPluginSetup;
  security: SecurityPluginSetup;
  spaces: SpacesPluginSetup;
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface GroupsPluginSetup {}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface GroupsPluginStart {}
