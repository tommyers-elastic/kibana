/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * A definition with `materialisation.mode: 'none'` must not produce Elasticsearch assets: no
 * component template of its own, no entry in the index templates' `composed_of`, and nothing to
 * delete on uninstall. The registry is mocked so that `service` is treated as non-materialised.
 */

import { loggerMock } from '@kbn/logging-mocks';
import type { ElasticsearchClient } from '@kbn/core/server';
import {
  getEntityDefinition,
  getMaterialisedEntityDefinitions,
  getMaterialisedEntityTypes,
} from '../../../common/domain/definitions/registry';
import type { EntityType } from '../../../common/domain/definitions/entity_schema';
import { getLatestEntityIndexTemplateConfig } from './latest_index_template';
import { getHistorySnapshotIndexTemplateConfig } from './history_snapshot_index_template';
import { getComponentTemplateName, getUpdatesComponentTemplateName } from './component_templates';
import { installSharedElasticsearchAssets, uninstallElasticsearchAssets } from './install_assets';

jest.mock('../../../common/domain/definitions/registry', () => ({
  ...jest.requireActual('../../../common/domain/definitions/registry'),
  getMaterialisedEntityTypes: jest.fn(),
  getMaterialisedEntityDefinitions: jest.fn(),
}));
jest.mock('../../infra/elasticsearch');
jest.mock('./migrate_legacy_security_assets', () => ({
  hasLegacySecurityAssets: jest.fn().mockResolvedValue(false),
  hasCollidingNeutralNamespaceAssets: jest.fn().mockResolvedValue(false),
  migrateLegacySecurityAssets: jest.fn(),
  ensureLegacyCompatibilityAliases: jest.fn(),
}));
jest.mock('./latest_index_ingest_pipeline', () => ({
  ...jest.requireActual('./latest_index_ingest_pipeline'),
  installLatestIndexIngestPipeline: jest.fn(),
}));
jest.mock('./metadata_index_ingest_pipeline', () => ({
  ...jest.requireActual('./metadata_index_ingest_pipeline'),
  installMetadataIndexIngestPipeline: jest.fn(),
}));
jest.mock('./resolve_entity_store_indices', () => ({
  resolveEntityStoreWriteTargets: jest.fn().mockResolvedValue({
    latestIndex: '.entities.v2.latest.default-00001',
  }),
}));

const { putComponentTemplate, deleteComponentTemplate } = jest.requireMock(
  '../../infra/elasticsearch'
) as { putComponentTemplate: jest.Mock; deleteComponentTemplate: jest.Mock };

const mockGetMaterialisedEntityTypes = getMaterialisedEntityTypes as jest.MockedFunction<
  () => EntityType[]
>;
const mockGetMaterialisedEntityDefinitions =
  getMaterialisedEntityDefinitions as jest.MockedFunction<typeof getMaterialisedEntityDefinitions>;

const NAMESPACE = 'default';
const MATERIALISED: EntityType[] = ['user', 'host', 'generic'];
const NOT_MATERIALISED: EntityType = 'service';

describe('materialisation mode gating of Elasticsearch assets', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMaterialisedEntityTypes.mockReturnValue(MATERIALISED);
    mockGetMaterialisedEntityDefinitions.mockImplementation((namespace) =>
      MATERIALISED.map((type) => getEntityDefinition(type, namespace))
    );
  });

  it('composes the latest index template only from materialised component templates', () => {
    const { composed_of: composedOf, ignore_missing_component_templates: ignoreMissing } =
      getLatestEntityIndexTemplateConfig(NAMESPACE);

    for (const type of MATERIALISED) {
      expect(composedOf).toContain(getComponentTemplateName(type, NAMESPACE));
    }
    expect(composedOf).not.toContain(getComponentTemplateName(NOT_MATERIALISED, NAMESPACE));
    expect(ignoreMissing).not.toContain(getComponentTemplateName(NOT_MATERIALISED, NAMESPACE));
  });

  it('composes the history snapshot index template only from materialised component templates', () => {
    const { composed_of: composedOf } = getHistorySnapshotIndexTemplateConfig(NAMESPACE);

    expect(composedOf).toHaveLength(1 + MATERIALISED.length);
    expect(composedOf).not.toContain(getComponentTemplateName(NOT_MATERIALISED, NAMESPACE));
  });

  it('installs a component template per materialised definition only', async () => {
    const esClient = {
      indices: {
        exists: jest.fn().mockResolvedValue(false),
        getAlias: jest.fn().mockRejectedValue({ meta: { statusCode: 404 } }),
      },
    } as unknown as ElasticsearchClient;

    await installSharedElasticsearchAssets({
      esClient,
      migrationEsClient: esClient,
      logger: loggerMock.create(),
      namespace: NAMESPACE,
      allowLegacyMigration: false,
    });

    const installedNames = putComponentTemplate.mock.calls.map(
      ([, template]: [unknown, { name: string }]) => template.name
    );
    for (const type of MATERIALISED) {
      expect(installedNames).toContain(getComponentTemplateName(type, NAMESPACE));
    }
    expect(installedNames).not.toContain(getComponentTemplateName(NOT_MATERIALISED, NAMESPACE));
  });

  it('deletes updates component templates for materialised types only on uninstall', async () => {
    const esClient = {
      indices: {
        getAlias: jest.fn().mockRejectedValue({ meta: { statusCode: 404 } }),
        resolveIndex: jest.fn().mockResolvedValue({ indices: [], aliases: [], data_streams: [] }),
      },
    } as unknown as ElasticsearchClient;

    await uninstallElasticsearchAssets({
      esClient,
      logger: loggerMock.create(),
      namespace: NAMESPACE,
    });

    const deletedNames = deleteComponentTemplate.mock.calls.map(
      ([, name]: [unknown, string]) => name
    );
    expect(deletedNames).toEqual(
      MATERIALISED.map((type) => getUpdatesComponentTemplateName(type, NAMESPACE))
    );
  });
});
