/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { loggerMock } from '@kbn/logging-mocks';
import type { TaskManagerSetupContract } from '@kbn/task-manager-plugin/server';
import { registerTasks } from './register_tasks';
import { registerExtractEntityTasks } from './extract_entity_task';
import { getMaterialisedEntityTypes } from '../../common/domain/definitions/registry';
import type { EntityType } from '../../common/domain/definitions/entity_schema';
import type { EntityStoreCoreSetup } from '../types';

jest.mock('./extract_entity_task', () => ({ registerExtractEntityTasks: jest.fn() }));
jest.mock('./history_snapshot_task', () => ({ registerHistorySnapshotTask: jest.fn() }));
jest.mock('./resilience_task', () => ({ registerResilienceTask: jest.fn() }));
jest.mock('./status_report_task', () => ({ registerStatusReportTask: jest.fn() }));
jest.mock('./legacy_security_assets_migration_task', () => ({
  registerLegacySecurityAssetsMigrationTask: jest.fn(),
}));
jest.mock('../../common/domain/definitions/registry', () => ({
  ...jest.requireActual('../../common/domain/definitions/registry'),
  getMaterialisedEntityTypes: jest.fn(),
}));

const mockRegisterExtractEntityTasks = registerExtractEntityTasks as jest.MockedFunction<
  typeof registerExtractEntityTasks
>;
const mockGetMaterialisedEntityTypes = getMaterialisedEntityTypes as jest.MockedFunction<
  () => EntityType[]
>;

describe('registerTasks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers extraction tasks for materialised entity types only', () => {
    mockGetMaterialisedEntityTypes.mockReturnValue(['host', 'user']);

    registerTasks(
      {} as TaskManagerSetupContract,
      loggerMock.create(),
      {} as EntityStoreCoreSetup,
      false
    );

    expect(mockRegisterExtractEntityTasks).toHaveBeenCalledTimes(1);
    expect(mockRegisterExtractEntityTasks.mock.calls[0][0].entityTypes).toEqual(['host', 'user']);
  });

  it('registers every built-in type when all are materialised', () => {
    mockGetMaterialisedEntityTypes.mockReturnValue(['user', 'host', 'service', 'generic']);

    registerTasks(
      {} as TaskManagerSetupContract,
      loggerMock.create(),
      {} as EntityStoreCoreSetup,
      false
    );

    expect(mockRegisterExtractEntityTasks.mock.calls[0][0].entityTypes).toEqual([
      'user',
      'host',
      'service',
      'generic',
    ]);
  });
});
