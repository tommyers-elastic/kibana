/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { schema } from '@kbn/config-schema';
import type { UiSettingsServiceSetup } from '@kbn/core/server';
import { ENTITY_INVENTORY_ENABLED_SETTING } from '../common';

export function registerUiSettings(uiSettings: UiSettingsServiceSetup): void {
  uiSettings.register({
    [ENTITY_INVENTORY_ENABLED_SETTING]: {
      name: 'Enable the entity inventory API',
      description:
        'Enables the Observability entity inventory routes that list, count and detail entities of registered entity types from raw telemetry',
      schema: schema.boolean(),
      value: false,
      requiresPageReload: false,
      readonly: true,
      readonlyMode: 'ui',
    },
  });
}
