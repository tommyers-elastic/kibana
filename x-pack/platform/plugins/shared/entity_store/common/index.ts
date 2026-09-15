/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * Lightweight `@kbn/entity-store/common` barrel (webpack `common` entry).
 * Keeps page-load size small: no euid / streamlang here — use `euid_helpers` or `loadEuidApi()`.
 *
 * Public API for the entity_store plugin. Exports only constants and types needed
 * on every load (including browser). For EUID translation helpers
 * (DSL/ESQL/Painless, entity types), use common/euid_helpers.
 *
 * @example
 * import { euid, type EntityType } from '@kbn/entity-store/common/euid_helpers';
 */

import { z } from '@kbn/zod/v4';
import {
  ALL_BUILT_IN_ENTITY_TYPES,
  BuiltInEntityType,
  isBuiltInEntityType,
} from './domain/definitions/built_in_entity_types';

export const PLUGIN_ID = 'entityStore';
export const PLUGIN_NAME = 'Entity Store';

export const FF_ENABLE_ENTITY_STORE_V2 = 'securitySolution:entityStoreEnableV2';

/** Cloud feature flag: when true, legacy `.entities.v2.*.security_{ns}` assets may be migrated. */
export const FF_MIGRATE_LEGACY_SECURITY_ASSETS = 'entityStore.migrateLegacySecurityAssets';

/** Cloud feature flag: master switch for dual-process log extraction (priority + non-priority). Default false. */
export const FF_DUAL_PROCESS_ENABLED = 'entityStore.dualProcess.enabled';

export {
  ENTITY_STORE_SOURCE_INDICES_PRIVILEGES,
  ENTITY_STORE_TARGET_INDICES_PRIVILEGES,
  ENTITY_STORE_CLUSTER_PRIVILEGES,
  ENGINE_DESCRIPTOR_TYPE_NAME,
  ENGINE_DESCRIPTOR_CREATE_PRIVILEGE,
} from './privileges';

export type EntityStoreStatus = z.infer<typeof EntityStoreStatus>;
export const EntityStoreStatus = z.enum([
  'not_installed',
  'installing',
  'running',
  'stopped',
  'error',
]);

export const API_VERSIONS = {
  public: {
    v1: '2023-10-31',
  },
  internal: {
    v2: '2',
  },
} as const;

const PUBLIC_BASE_ROUTE = '/api/security/entity_store';
const INTERNAL_BASE_ROUTE = '/internal/security/entity_store';

export const ENTITY_STORE_ROUTES = {
  public: {
    INSTALL: `${PUBLIC_BASE_ROUTE}/install`,
    UPDATE: PUBLIC_BASE_ROUTE,
    UNINSTALL: `${PUBLIC_BASE_ROUTE}/uninstall`,
    STATUS: `${PUBLIC_BASE_ROUTE}/status`,
    START: `${PUBLIC_BASE_ROUTE}/start`,
    STOP: `${PUBLIC_BASE_ROUTE}/stop`,
    CRUD_CREATE: `${PUBLIC_BASE_ROUTE}/entities/{entityType}`,
    CRUD_UPDATE: `${PUBLIC_BASE_ROUTE}/entities/{entityType}`,
    CRUD_BULK_UPDATE: `${PUBLIC_BASE_ROUTE}/entities/bulk`,
    CRUD_GET: `${PUBLIC_BASE_ROUTE}/entities`,
    CRUD_DELETE: `${PUBLIC_BASE_ROUTE}/entities/`,
    RESOLUTION_LINK: `${PUBLIC_BASE_ROUTE}/resolution/link`,
    RESOLUTION_UNLINK: `${PUBLIC_BASE_ROUTE}/resolution/unlink`,
    RESOLUTION_GROUP: `${PUBLIC_BASE_ROUTE}/resolution/group`,
    RESOLUTION_RULES_LIST: `${PUBLIC_BASE_ROUTE}/resolution/rules`,
    RESOLUTION_RULES_ENABLE: `${PUBLIC_BASE_ROUTE}/resolution/rules/{id}/enable`,
    RESOLUTION_RULES_DISABLE: `${PUBLIC_BASE_ROUTE}/resolution/rules/{id}/disable`,
  },
  internal: {
    CHECK_PRIVILEGES: `${INTERNAL_BASE_ROUTE}/check_privileges`,
    FORCE_LOG_EXTRACTION: `${INTERNAL_BASE_ROUTE}/{entityType}/force_log_extraction`,
    FORCE_HISTORY_SNAPSHOT: `${INTERNAL_BASE_ROUTE}/force_history_snapshot`,
    ENTITY_MAINTAINERS_START: `${INTERNAL_BASE_ROUTE}/entity_maintainers/start/{id}`,
    ENTITY_MAINTAINERS_STOP: `${INTERNAL_BASE_ROUTE}/entity_maintainers/stop/{id}`,
    ENTITY_MAINTAINERS_RUN: `${INTERNAL_BASE_ROUTE}/entity_maintainers/run/{id}`,
    ENTITY_MAINTAINERS_GET: `${INTERNAL_BASE_ROUTE}/entity_maintainers`,
    ENTITY_MAINTAINERS_INIT: `${INTERNAL_BASE_ROUTE}/entity_maintainers/init`,
  },
} as const satisfies Record<string, Record<string, string>>;

export {
  EntityMaintainerTaskStatus,
  EntityMaintainerResponseItem,
  GetEntityMaintainersResponse,
} from './entity_maintainers';

export { RESOLUTION_RULE_IDS, RESOLUTION_RULE_KINDS } from './domain/resolution_rules/constants';
export type { ResolutionRuleId, ResolutionRuleKind } from './domain/resolution_rules/constants';

export const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return String(error);
};

// Entity types (slim definitions; for EUID translation use common/euid_helpers).
// `EntityType` is any type name (built-in or dynamically registered); `BuiltInEntityType` is the
// closed set of the four Security types that have engines.
export type EntityType = string;
/** @deprecated Value alias for `BuiltInEntityType`; as a type, `EntityType` is now any type name. */
export const EntityType = BuiltInEntityType;
/** @deprecated Use `ALL_BUILT_IN_ENTITY_TYPES`: dynamic definitions are not in this list. */
export const ALL_ENTITY_TYPES = ALL_BUILT_IN_ENTITY_TYPES;
export { BuiltInEntityType, ALL_BUILT_IN_ENTITY_TYPES, isBuiltInEntityType };

export { ExtractionMode } from './domain/definitions/entity_schema';

// Definition schema types (identity core + extensions). Type-only: the zod schemas live in
// `common/domain/definitions/entity_schema` and must not be pulled into this page-load barrel.
export type {
  EntityIdentityCore,
  EntityDefinition,
  EntityDefinitionWithoutId,
  MaterialisedEntityDefinition,
  MaterialisationMode,
  InventoryExtension,
} from './domain/definitions/entity_schema';

export type {
  Entity,
  HostEntity,
  UserEntity,
  ServiceEntity,
  GenericEntity,
  EntityField,
  EngineMetadata,
  Asset,
} from './domain/definitions/entity.gen';
export type {
  EntitySummaryHighlight,
  EntitySummaryStaleness,
  EntitySummaryStalenessSignal,
  EntitySummaryStalenessSnapshot,
  EntitySummaryStalenessEntitySnapshot,
  EntitySummaryStalenessReason,
  SaveEntityAiSummaryParams,
  SaveEntityAiSummarySummary,
  PersistedEntityAiSummary,
  GetPersistedAiSummaryResponse,
} from './domain/definitions/entity_summary_staleness';
// Entity AI summary runtime helpers (staleness detection, structural caps, request-length
// caps) intentionally live behind the `@kbn/entity-store/common/entity_summary` subpath, NOT
// this page-load barrel, so they only ship in the chunks that use them (lazy flyout / server)
// rather than on every page load. Only the erased-at-build-time types stay in the barrel.
export type {
  EntitySummaryContent,
  CappedEntitySummaryContent,
} from './domain/definitions/entity_summary_limits';

export interface IdentitySourceFields {
  /** Fields that participate in identity (EUID composition). */
  requiresOneOf: string[];
  /** All field names used in EUID composition, deduplicated. */
  identitySourceFields: string[];
}

export type { NonEcsTimelineDataRow } from './domain/euid/non_ecs_timeline_data';
export type { AssetCriticalityLevel, EntityRiskLevels } from './domain/definitions/entity.gen';

export {
  ENTITY_LATEST,
  ENTITY_UPDATES,
  ENTITY_HISTORY,
  ENTITY_METADATA,
  ENTITY_BASE_PREFIX,
  ENTITY_SCHEMA_VERSION_V2,
  MAPPING_VERSION,
  getEntityIndexPattern,
  getLegacySecurityEntityIndexPattern,
  getEntitiesAlias,
  getLatestEntitiesIndexName,
  getLatestEntityIndexPattern,
  getLegacySecurityLatestEntitiesIndexName,
  getLegacySecurityLatestEntityIndexPattern,
  getEntityMetadataAlias,
  getMetadataEntityIndexPattern,
} from './domain/entity_index';

export type {
  EngineStatus,
  EngineDescriptor,
  EngineComponentResource,
  EngineComponentStatus,
  GetEntityStoreStatusResponse,
  InitEntityStoreResponse,
  InspectQuery,
  ListEntitiesResponse,
} from './api_types';

export {
  RELATIONSHIP_KINDS,
  normalizeRelationshipRecord,
} from './domain/entity_metadata/relationship_metadata';
export type {
  RelationshipKind,
  RelationshipMetadataDoc,
  RelationshipMetadataMaintainer,
} from './domain/entity_metadata/relationship_metadata';
export { AI_SUMMARY_EVENT_ACTION } from './domain/entity_metadata/ai_summary_metadata';
export type {
  AiSummaryMetadataDoc,
  AiSummaryHighlightItem,
  AiSummaryMetadataStaleness,
  AiSummaryMetadataStalenessSnapshot,
} from './domain/entity_metadata/ai_summary_metadata';

// Dynamic entity definitions (Observability inventory). Space-scoped, `mode: 'none'` only.
export type {
  EntityDefinitionRecord,
  EntityDefinitionSource,
} from './domain/definitions/definition_record';

/** UI setting (API-only, hidden from the advanced settings UI) gating the definitions API. */
export const FF_ENABLE_DYNAMIC_DEFINITIONS = 'entityStore:dynamicDefinitionsEnabled';

/** Saved object type holding API-registered definitions. */
export const ENTITY_DEFINITION_SAVED_OBJECT_TYPE = 'entity-store-definition';

/** Kibana feature that grants the definitions API privileges; neutral, not tied to Security. */
export const ENTITY_DEFINITIONS_FEATURE_ID = 'entityDefinitions';

export const ENTITY_DEFINITIONS_API_PRIVILEGES = {
  read: 'read_entity_definitions',
  manage: 'manage_entity_definitions',
} as const;

const INTERNAL_DEFINITIONS_BASE_ROUTE = '/internal/entity_store/definitions';

export const ENTITY_DEFINITIONS_ROUTES = {
  LIST: INTERNAL_DEFINITIONS_BASE_ROUTE,
  CREATE: INTERNAL_DEFINITIONS_BASE_ROUTE,
  GET: `${INTERNAL_DEFINITIONS_BASE_ROUTE}/{type}`,
  REPLACE: `${INTERNAL_DEFINITIONS_BASE_ROUTE}/{type}`,
  DELETE: `${INTERNAL_DEFINITIONS_BASE_ROUTE}/{type}`,
} as const;
