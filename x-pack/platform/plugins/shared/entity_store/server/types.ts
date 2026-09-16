/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type {
  TaskManagerSetupContract,
  TaskManagerStartContract,
} from '@kbn/task-manager-plugin/server';
import type { PluginStart as DataViewsPluginStart } from '@kbn/data-views-plugin/server';
import type { SecurityPluginStart } from '@kbn/security-plugin-types-server';
import type {
  EncryptedSavedObjectsPluginSetup,
  EncryptedSavedObjectsPluginStart,
} from '@kbn/encrypted-saved-objects-plugin/server';
import type {
  WorkflowsExtensionsServerPluginSetup,
  WorkflowsExtensionsServerPluginStart,
} from '@kbn/workflows-extensions/server';
import type {
  CoreRequestHandlerContext,
  CustomRequestHandlerContext,
} from '@kbn/core-http-request-handler-context-server';
import type { IRouter } from '@kbn/core-http-server';
import type { Logger } from '@kbn/logging';
import type {
  LicensingApiRequestHandlerContext,
  LicensingPluginStart,
} from '@kbn/licensing-plugin/server';
import type { SpacesPluginSetup, SpacesPluginStart } from '@kbn/spaces-plugin/server';
import type { CoreSetup } from '@kbn/core/server';
import type { UsageCollectionSetup } from '@kbn/usage-collection-plugin/server';
import type { ElasticsearchClient } from '@kbn/core/server';
import type { FeaturesPluginSetup } from '@kbn/features-plugin/server';
import type { AssetManagerClient } from './domain/asset_manager';
import type {
  EntityMaintainersClient,
  EntityMaintainerStatusEntry,
} from './domain/entity_maintainers';
import type { FeatureFlags } from './infra/feature_flags';
import type { LogsExtractionClient } from './domain/logs_extraction';
import type { HistorySnapshotClient } from './domain/history_snapshot';
import type { CRUDClient } from './domain/crud';
import type { EntityMetadataClient } from './domain/entity_metadata';
import type { RelationshipsClient } from './domain/relationships';
import type { ResolutionClient } from './domain/resolution';
import type { ResolutionRulesClient } from './domain/resolution/rules';
import type { RegisterEntityMaintainerConfig } from './tasks/entity_maintainers/types';
import type { TelemetryReporter } from './telemetry/events';
import type {
  BuiltInInventoryExtensionDocument,
  EntityDefinitionWithoutId,
} from '../common/domain/definitions/entity_schema';
import type { EntityDefinitionRegistry, EntityDefinitionsClient } from './domain/definitions';

export interface EntityStoreSetupPlugins {
  taskManager: TaskManagerSetupContract;
  spaces: SpacesPluginSetup;
  encryptedSavedObjects: EncryptedSavedObjectsPluginSetup;
  workflowsExtensions: WorkflowsExtensionsServerPluginSetup;
  usageCollection?: UsageCollectionSetup;
  features: FeaturesPluginSetup;
}

export interface EntityStoreStartPlugins {
  taskManager: TaskManagerStartContract;
  spaces: SpacesPluginStart;
  dataViews: DataViewsPluginStart;
  security: SecurityPluginStart;
  encryptedSavedObjects: EncryptedSavedObjectsPluginStart;
  licensing: LicensingPluginStart;
  workflowsExtensions: WorkflowsExtensionsServerPluginStart;
}

export interface EntityStoreApiRequestHandlerContext {
  core: CoreRequestHandlerContext;
  logger: Logger;
  assetManagerClient: AssetManagerClient;
  entityMaintainersClient: EntityMaintainersClient;
  crudClient: CRUDClient;
  entityMetadataClient: EntityMetadataClient;
  relationshipsClient: RelationshipsClient;
  resolutionClient: ResolutionClient;
  entityResolutionRuleClient: ResolutionRulesClient;
  featureFlags: FeatureFlags;
  logsExtractionClient: LogsExtractionClient;
  historySnapshotClient: HistorySnapshotClient;
  security: SecurityPluginStart;
  /** Read side of entity definitions (built-in, code-registered and API-registered) for the request space. */
  entityDefinitionRegistry: EntityDefinitionRegistry;
  /** Write side of API-registered definitions; built over the request-scoped saved objects client. */
  entityDefinitionsClient: EntityDefinitionsClient;
  namespace: string;
  analytics: TelemetryReporter;
}

export type EntityStoreRequestHandlerContext = CustomRequestHandlerContext<{
  entityStore: EntityStoreApiRequestHandlerContext;
  licensing: LicensingApiRequestHandlerContext;
}>;

export type EntityStorePluginRouter = IRouter<EntityStoreRequestHandlerContext>;

export type RegisterEntityMaintainer = (config: RegisterEntityMaintainerConfig) => void;

export type EntityStoreCRUDClient = Omit<CRUDClient, 'createEntity'>;

export interface EntityStoreStartContract {
  createCRUDClient: (
    esClient: ElasticsearchClient,
    namespace: string,
    getWorkflowsClient?: () => Promise<{
      emitEvent: (triggerId: string, payload: Record<string, unknown>) => Promise<void>;
    }>
  ) => EntityStoreCRUDClient;
  createEntityMetadataClient: (
    esClient: ElasticsearchClient,
    namespace: string
  ) => EntityMetadataClient;
  createRelationshipsClient: (
    esClient: ElasticsearchClient,
    namespace: string
  ) => RelationshipsClient;
  createResolutionClient: (esClient: ElasticsearchClient, namespace: string) => ResolutionClient;
  getMaintainerStatus: (
    namespace: string,
    ids?: string[]
  ) => Promise<EntityMaintainerStatusEntry[]>;
  /**
   * Resolves entity definitions by type for a space: the four built-ins, definitions registered
   * in code at setup and definitions registered per space through the API. Reads use an internal
   * saved objects repository, so the caller is responsible for authorising its own user.
   */
  getEntityDefinitionRegistry: (namespace: string) => EntityDefinitionRegistry;
}

export interface EntityStoreSetupContract {
  registerEntityMaintainer: RegisterEntityMaintainer;
  /**
   * Registers a code-defined, non-materialised entity definition (e.g. Observability types shipped
   * with Kibana). Global across spaces, held in memory, resolvable by the registry and the EUID
   * compiler. Throws on an invalid definition, a reserved (built-in or already registered) type
   * name, or a materialisation mode other than `none`.
   */
  registerEntityDefinition: (definition: EntityDefinitionWithoutId) => void;
  /**
   * Attaches an inventory extension (label, attributes, sources) to one of the built-in Security
   * types (e.g. an Observability `host` inventory view) with the same `{ extends, inventory }`
   * document the definitions API accepts. Global across spaces, held in memory, served by the
   * registry as `definition.inventory` on the built-in record and taking precedence over an
   * extension registered through the API. The built-in definition's identity and materialisation
   * are never changed, so entity ids stay the built-in's (`host:...`). Throws on an invalid
   * document, an `extends` that is not built-in, a type that already has a code extension, or an
   * attribute that is an identity field of the built-in.
   */
  registerInventoryExtension: (document: BuiltInInventoryExtensionDocument) => void;
}

export type EntityStoreCoreSetup = CoreSetup<EntityStoreStartPlugins, EntityStoreStartContract>;
