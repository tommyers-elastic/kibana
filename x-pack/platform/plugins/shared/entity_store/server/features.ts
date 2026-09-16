/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { DEFAULT_APP_CATEGORIES } from '@kbn/core/server';
import type { FeaturesPluginSetup } from '@kbn/features-plugin/server';
import { i18n } from '@kbn/i18n';
import {
  ENTITY_DEFINITIONS_API_PRIVILEGES,
  ENTITY_DEFINITIONS_FEATURE_ID,
  ENTITY_DEFINITION_SAVED_OBJECT_TYPE,
  ENTITY_INVENTORY_EXTENSION_SAVED_OBJECT_TYPE,
} from '../common';

const DEFINITIONS_SAVED_OBJECT_TYPES = [
  ENTITY_DEFINITION_SAVED_OBJECT_TYPE,
  ENTITY_INVENTORY_EXTENSION_SAVED_OBJECT_TYPE,
];

/**
 * Neutral Kibana feature gating the entity definitions API. It deliberately does not reuse the
 * Security Solution privileges: Observability registers read-only definitions in spaces where the
 * Security entity store may never be enabled. `read` lists and reads definitions; `all` also
 * creates, replaces and deletes them.
 */
export function registerEntityDefinitionsFeature(features: FeaturesPluginSetup): void {
  features.registerKibanaFeature({
    id: ENTITY_DEFINITIONS_FEATURE_ID,
    name: i18n.translate('entityStore.features.entityDefinitions.name', {
      defaultMessage: 'Entity definitions',
    }),
    description: i18n.translate('entityStore.features.entityDefinitions.description', {
      defaultMessage: 'Register and manage the entity types served by the entity inventory.',
    }),
    order: 1600,
    category: DEFAULT_APP_CATEGORIES.management,
    app: [],
    privileges: {
      all: {
        app: [],
        savedObject: {
          all: DEFINITIONS_SAVED_OBJECT_TYPES,
          read: [],
        },
        api: [ENTITY_DEFINITIONS_API_PRIVILEGES.read, ENTITY_DEFINITIONS_API_PRIVILEGES.manage],
        ui: [],
      },
      read: {
        app: [],
        savedObject: {
          all: [],
          read: DEFINITIONS_SAVED_OBJECT_TYPES,
        },
        api: [ENTITY_DEFINITIONS_API_PRIVILEGES.read],
        ui: [],
      },
    },
  });
}
