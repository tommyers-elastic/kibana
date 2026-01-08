/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { KibanaRequest } from '@kbn/core/server';
import type { DefaultRouteHandlerResources } from '@kbn/server-route-repository';
import type { GroupsStorageClient } from '../lib/storage/groups_storage_client';
import type { MembersStorageClient } from '../lib/storage/members_storage_client';
import type { ACLService } from '../lib/acl';

export interface GroupsRouteHandlerScopedClients {
  groupsClient: GroupsStorageClient;
  membersClient: MembersStorageClient;
  aclService: ACLService;
}

export type GetScopedClients = ({
  request,
}: {
  request: KibanaRequest;
}) => Promise<GroupsRouteHandlerScopedClients>;

export interface RouteDependencies {
  getScopedClients: GetScopedClients;
}

export type GroupsRouteHandlerResources = RouteDependencies & DefaultRouteHandlerResources;
