/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { AGENT_BUILDER_RECOMMENDED_ENDPOINTS } from '@kbn/agent-builder-common/constants';
import type { SearchInferenceEndpointsPluginSetup } from '@kbn/search-inference-endpoints/server';
import type { Logger } from '@kbn/core/server';

/** Feature ids must match `^[a-z][a-z0-9_]*$` (no dots), see the plugin's `validate_feature.ts`. */
export const ENTITY_INVENTORY_INFERENCE_FEATURE_ID = 'observability_entity_inventory';
export const DEFINITION_AUTHORING_INFERENCE_FEATURE_ID =
  'observability_entity_inventory_definition_authoring';

/**
 * Registers the Stack Management > Model Management > Feature Settings cards. Agent Builder picks
 * the model of a conversation from the user's selection and its own `agent_builder` feature, not
 * per agent, so the selection made here is not yet consumed at runtime (see the README).
 */
export const registerInferenceFeatures = ({
  searchInferenceEndpoints,
  logger,
}: {
  searchInferenceEndpoints: SearchInferenceEndpointsPluginSetup;
  logger: Logger;
}): void => {
  const parent = searchInferenceEndpoints.features.register({
    featureId: ENTITY_INVENTORY_INFERENCE_FEATURE_ID,
    featureName: 'Entity inventory',
    featureDescription: 'AI models used by the entity inventory',
    taskType: 'chat_completion',
    recommendedEndpoints: AGENT_BUILDER_RECOMMENDED_ENDPOINTS,
  });
  if (!parent.ok) {
    logger.warn(`Could not register the entity inventory model feature: ${parent.error}`);
    return;
  }
  const child = searchInferenceEndpoints.features.register({
    parentFeatureId: ENTITY_INVENTORY_INFERENCE_FEATURE_ID,
    featureId: DEFINITION_AUTHORING_INFERENCE_FEATURE_ID,
    featureName: 'Definition authoring',
    featureDescription: 'Model used by the entity definition author agent',
    taskType: 'chat_completion',
    recommendedEndpoints: AGENT_BUILDER_RECOMMENDED_ENDPOINTS,
  });
  if (!child.ok) {
    logger.warn(`Could not register the definition authoring model feature: ${child.error}`);
  }
};
