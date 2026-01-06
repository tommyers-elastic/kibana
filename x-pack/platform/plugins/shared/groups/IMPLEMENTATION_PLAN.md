# Groups Plugin - Implementation Plan

> **POC for associating Kibana and Elasticsearch assets together**

This document provides a detailed implementation plan for an AI coding assistant to build out a "groups" concept in Kibana. Groups allow users to associate many types of assets (dashboards, rules, SLOs, streams, ingest pipelines, data views, etc.) together.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture Decisions](#2-architecture-decisions)
3. [Plugin Structure](#3-plugin-structure)
4. [Storage Layer](#4-storage-layer)
5. [API Endpoints](#5-api-endpoints)
6. [Access Control (ACL)](#6-access-control-acl)
7. [Embeddables](#7-embeddables)
8. [Testing](#8-testing)
9. [Implementation Order](#9-implementation-order)

---

## 1. Overview

### 1.1 Goals

- Create a "groups" concept to associate many types of ES and Kibana assets together
- Groups should have names, descriptions, and metadata
- Groups should be searchable via regular ESQL
- Implement per-group access control (advanced ACL)
- Provide a dashboard-based landing page with custom embeddables

### 1.2 Key Features

| Feature | Description |
|---------|-------------|
| Create/Delete Groups | CRUD operations for group management |
| Register/Unregister Items | Link/unlink assets to groups |
| Find Groups | Query by name, ID, or containing item |
| Multi-group Membership | Assets can belong to multiple groups |
| Per-group ACL | Fine-grained access control per group |
| Dashboard Landing Page | Custom embeddables for group visualization |

### 1.3 Reference Implementation

This implementation follows patterns from the **streams** plugin:
- Location: `/x-pack/platform/plugins/shared/streams/`
- Storage: `@kbn/storage-adapter` with custom ES indices
- Routes: `@kbn/server-route-repository` with versioned APIs
- Testing: FTR tests in `x-pack/platform/test/api_integration_deployment_agnostic/`

---

## 2. Architecture Decisions

### 2.1 Storage Approach: Hybrid (Option C)

**Two Elasticsearch indices:**

| Index | Purpose | Schema |
|-------|---------|--------|
| `.kibana_groups` | Group metadata + ACL | `id`, `name`, `description`, `metadata`, `acl`, `created_at`, `updated_at` |
| `.kibana_groups_members` | Asset-to-group links | `id`, `group_id`, `asset_type`, `asset_id`, `added_at`, `added_by` |

**Rationale:**
- Efficient ESQL queries for both group lookups and membership queries
- Supports multi-group membership without duplication
- Clean separation of concerns
- Scalable for large numbers of assets per group

### 2.2 Asset Type Handling

| Asset Type | Storage Type | Handler Strategy |
|------------|--------------|------------------|
| Dashboards | Saved Object (`dashboard`) | Generic SO handler |
| Alert Rules | Saved Object (`alert`) | Generic SO handler |
| SLOs | Saved Object (`slo`) | Generic SO handler |
| Data Views | Saved Object (`index-pattern`) | Generic SO handler |
| Saved Searches | Saved Object (`search`) | Generic SO handler |
| Ingest Pipelines | ES Native | ES API handler |
| Index Templates | ES Native | ES API handler |
| Streams | Custom ES Index | Streams API handler |

### 2.3 Access Control Model

**Per-group ACL stored in group documents:**

```typescript
interface GroupACL {
  owner: string;           // User ID of group creator
  permissions: Array<{
    principal: {
      type: 'user' | 'role';
      id: string;
    };
    access: 'read' | 'write' | 'admin';
  }>;
}
```

**Access Levels:**
- `read`: View group and its members
- `write`: Add/remove members, update group metadata
- `admin`: Delete group, manage ACL

### 2.4 Plugin Placement

Follow streams pattern - single plugin in shared location:
- Path: `/x-pack/platform/plugins/shared/groups/`

---

## 3. Plugin Structure

### 3.1 Directory Layout

```
x-pack/platform/plugins/shared/groups/
├── kibana.jsonc
├── tsconfig.json
├── jest.config.js
├── README.md
├── common/
│   ├── index.ts
│   ├── constants.ts
│   ├── types.ts
│   └── schemas.ts
├── server/
│   ├── index.ts
│   ├── plugin.ts
│   ├── types.ts
│   ├── lib/
│   │   ├── groups/
│   │   │   ├── index.ts
│   │   │   ├── groups_client.ts
│   │   │   ├── groups_storage_client.ts
│   │   │   └── storage_settings.ts
│   │   ├── members/
│   │   │   ├── index.ts
│   │   │   ├── members_client.ts
│   │   │   ├── members_storage_client.ts
│   │   │   └── storage_settings.ts
│   │   ├── acl/
│   │   │   ├── index.ts
│   │   │   ├── acl_service.ts
│   │   │   └── types.ts
│   │   └── assets/
│   │       ├── index.ts
│   │       ├── asset_resolver.ts
│   │       ├── handlers/
│   │       │   ├── saved_object_handler.ts
│   │       │   ├── es_native_handler.ts
│   │       │   └── streams_handler.ts
│   │       └── types.ts
│   └── routes/
│       ├── index.ts
│       ├── create_server_route.ts
│       ├── groups/
│       │   └── route.ts
│       ├── members/
│       │   └── route.ts
│       └── internal/
│           └── route.ts
└── public/
    ├── index.ts
    ├── plugin.ts
    ├── types.ts
    ├── components/
    │   ├── group_info/
    │   │   ├── index.ts
    │   │   └── group_info.tsx
    │   └── dashboard_list/
    │       ├── index.ts
    │       └── dashboard_list.tsx
    └── embeddables/
        ├── index.ts
        ├── group_info/
        │   ├── constants.ts
        │   ├── types.ts
        │   └── group_info_embeddable_factory.tsx
        └── dashboard_list/
            ├── constants.ts
            ├── types.ts
            └── dashboard_list_embeddable_factory.tsx
```

### 3.2 Plugin Manifest (kibana.jsonc)

```jsonc
// x-pack/platform/plugins/shared/groups/kibana.jsonc
{
  "type": "plugin",
  "id": "@kbn/groups-plugin",
  "owner": "@elastic/YOUR_TEAM",
  "description": "Groups - Associate Kibana and Elasticsearch assets together",
  "group": "platform",
  "visibility": "shared",
  "plugin": {
    "id": "groups",
    "server": true,
    "browser": true,
    "configPath": ["xpack", "groups"],
    "requiredPlugins": [
      "features",
      "security",
      "embeddable",
      "uiActions",
      "dashboard",
      "data"
    ],
    "optionalPlugins": [
      "streams",
      "slo",
      "alerting"
    ],
    "requiredBundles": [
      "kibanaReact"
    ]
  }
}
```

---

## 4. Storage Layer

### 4.1 Groups Index Schema

**File:** `server/lib/groups/storage_settings.ts`

```typescript
import { StorageIndexAdapter, types } from '@kbn/storage-adapter';

export const GROUPS_INDEX_NAME = '.kibana_groups';

export const groupsStorageSettings = {
  name: GROUPS_INDEX_NAME,
  schema: {
    properties: {
      id: types.keyword({ required: true }),
      name: types.keyword({ required: true }),
      description: types.text({ required: false }),
      metadata: types.object({
        enabled: true,
        dynamic: true,
      }),
      acl: types.object({
        enabled: true,
        properties: {
          owner: types.keyword({ required: true }),
          permissions: types.nested({
            properties: {
              principal: types.object({
                properties: {
                  type: types.keyword({ required: true }),
                  id: types.keyword({ required: true }),
                },
              }),
              access: types.keyword({ required: true }),
            },
          }),
        },
      }),
      created_at: types.date({ required: true }),
      updated_at: types.date({ required: true }),
      created_by: types.keyword({ required: true }),
    },
  },
};

export type GroupsStorageClient = StorageIndexAdapter<typeof groupsStorageSettings>;
```

### 4.2 Members Index Schema

**File:** `server/lib/members/storage_settings.ts`

```typescript
import { StorageIndexAdapter, types } from '@kbn/storage-adapter';

export const MEMBERS_INDEX_NAME = '.kibana_groups_members';

export const membersStorageSettings = {
  name: MEMBERS_INDEX_NAME,
  schema: {
    properties: {
      id: types.keyword({ required: true }),
      group_id: types.keyword({ required: true }),
      asset_type: types.keyword({ required: true }),
      asset_id: types.keyword({ required: true }),
      added_at: types.date({ required: true }),
      added_by: types.keyword({ required: true }),
    },
  },
};

export type MembersStorageClient = StorageIndexAdapter<typeof membersStorageSettings>;
```

### 4.3 Groups Storage Client

**File:** `server/lib/groups/groups_storage_client.ts`

```typescript
import { StorageIndexAdapter } from '@kbn/storage-adapter';
import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import { groupsStorageSettings } from './storage_settings';
import type { Group, GroupDocument, CreateGroupParams, UpdateGroupParams } from './types';

export class GroupsStorageClient {
  private adapter: StorageIndexAdapter<typeof groupsStorageSettings>;

  constructor(
    private readonly esClient: ElasticsearchClient,
    private readonly logger: Logger
  ) {
    this.adapter = new StorageIndexAdapter(esClient, logger, groupsStorageSettings);
  }

  async initialize(): Promise<void> {
    await this.adapter.install();
  }

  async create(params: CreateGroupParams): Promise<Group> {
    const now = new Date().toISOString();
    const doc: GroupDocument = {
      id: params.id,
      name: params.name,
      description: params.description ?? '',
      metadata: params.metadata ?? {},
      acl: {
        owner: params.createdBy,
        permissions: [],
      },
      created_at: now,
      updated_at: now,
      created_by: params.createdBy,
    };

    await this.adapter.index({
      id: params.id,
      document: doc,
      refresh: 'wait_for',
    });

    return this.documentToGroup(doc);
  }

  async get(id: string): Promise<Group | null> {
    try {
      const result = await this.adapter.get({ id });
      return result ? this.documentToGroup(result._source) : null;
    } catch (error) {
      if (error.meta?.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async update(id: string, params: UpdateGroupParams): Promise<Group> {
    const existing = await this.get(id);
    if (!existing) {
      throw new Error(`Group not found: ${id}`);
    }

    const doc: Partial<GroupDocument> = {
      ...params,
      updated_at: new Date().toISOString(),
    };

    await this.adapter.update({
      id,
      document: doc,
      refresh: 'wait_for',
    });

    return { ...existing, ...params, updatedAt: doc.updated_at! };
  }

  async delete(id: string): Promise<void> {
    await this.adapter.delete({
      id,
      refresh: 'wait_for',
    });
  }

  async search(query: {
    name?: string;
    ids?: string[];
    from?: number;
    size?: number;
  }): Promise<{ groups: Group[]; total: number }> {
    const must: any[] = [];

    if (query.name) {
      must.push({ wildcard: { name: `*${query.name}*` } });
    }
    if (query.ids?.length) {
      must.push({ terms: { id: query.ids } });
    }

    const result = await this.adapter.search({
      query: must.length ? { bool: { must } } : { match_all: {} },
      from: query.from ?? 0,
      size: query.size ?? 20,
      sort: [{ created_at: 'desc' }],
    });

    return {
      groups: result.hits.hits.map((hit) => this.documentToGroup(hit._source!)),
      total: typeof result.hits.total === 'number' 
        ? result.hits.total 
        : result.hits.total?.value ?? 0,
    };
  }

  private documentToGroup(doc: GroupDocument): Group {
    return {
      id: doc.id,
      name: doc.name,
      description: doc.description,
      metadata: doc.metadata,
      acl: doc.acl,
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
      createdBy: doc.created_by,
    };
  }
}
```

### 4.4 Members Storage Client

**File:** `server/lib/members/members_storage_client.ts`

```typescript
import { StorageIndexAdapter } from '@kbn/storage-adapter';
import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import { membersStorageSettings } from './storage_settings';
import type { Member, MemberDocument, AddMemberParams } from './types';
import { v4 as uuidv4 } from 'uuid';

export class MembersStorageClient {
  private adapter: StorageIndexAdapter<typeof membersStorageSettings>;

  constructor(
    private readonly esClient: ElasticsearchClient,
    private readonly logger: Logger
  ) {
    this.adapter = new StorageIndexAdapter(esClient, logger, membersStorageSettings);
  }

  async initialize(): Promise<void> {
    await this.adapter.install();
  }

  async add(params: AddMemberParams): Promise<Member> {
    const id = uuidv4();
    const doc: MemberDocument = {
      id,
      group_id: params.groupId,
      asset_type: params.assetType,
      asset_id: params.assetId,
      added_at: new Date().toISOString(),
      added_by: params.addedBy,
    };

    await this.adapter.index({
      id,
      document: doc,
      refresh: 'wait_for',
    });

    return this.documentToMember(doc);
  }

  async remove(params: { groupId: string; assetType: string; assetId: string }): Promise<void> {
    await this.adapter.deleteByQuery({
      query: {
        bool: {
          must: [
            { term: { group_id: params.groupId } },
            { term: { asset_type: params.assetType } },
            { term: { asset_id: params.assetId } },
          ],
        },
      },
      refresh: true,
    });
  }

  async getByGroup(groupId: string, options?: { 
    assetType?: string; 
    from?: number; 
    size?: number;
  }): Promise<{ members: Member[]; total: number }> {
    const must: any[] = [{ term: { group_id: groupId } }];
    
    if (options?.assetType) {
      must.push({ term: { asset_type: options.assetType } });
    }

    const result = await this.adapter.search({
      query: { bool: { must } },
      from: options?.from ?? 0,
      size: options?.size ?? 100,
      sort: [{ added_at: 'desc' }],
    });

    return {
      members: result.hits.hits.map((hit) => this.documentToMember(hit._source!)),
      total: typeof result.hits.total === 'number' 
        ? result.hits.total 
        : result.hits.total?.value ?? 0,
    };
  }

  async getByAsset(assetType: string, assetId: string): Promise<Member[]> {
    const result = await this.adapter.search({
      query: {
        bool: {
          must: [
            { term: { asset_type: assetType } },
            { term: { asset_id: assetId } },
          ],
        },
      },
      size: 1000,
    });

    return result.hits.hits.map((hit) => this.documentToMember(hit._source!));
  }

  async findGroupsContainingAsset(
    assetType: string, 
    assetId: string
  ): Promise<string[]> {
    const members = await this.getByAsset(assetType, assetId);
    return [...new Set(members.map((m) => m.groupId))];
  }

  async removeAllByGroup(groupId: string): Promise<void> {
    await this.adapter.deleteByQuery({
      query: { term: { group_id: groupId } },
      refresh: true,
    });
  }

  private documentToMember(doc: MemberDocument): Member {
    return {
      id: doc.id,
      groupId: doc.group_id,
      assetType: doc.asset_type,
      assetId: doc.asset_id,
      addedAt: doc.added_at,
      addedBy: doc.added_by,
    };
  }
}
```

### 4.5 ESQL Query Examples

**Find all groups a dashboard belongs to:**
```esql
FROM .kibana_groups_members
| WHERE asset_type == "dashboard" AND asset_id == "my-dashboard-id"
| STATS group_ids = VALUES(group_id)
```

**Get all dashboards in a group:**
```esql
FROM .kibana_groups_members
| WHERE group_id == "my-group-id" AND asset_type == "dashboard"
| KEEP asset_id, added_at, added_by
| SORT added_at DESC
```

**Search groups by name:**
```esql
FROM .kibana_groups
| WHERE name LIKE "*production*"
| KEEP id, name, description, created_at
| SORT created_at DESC
| LIMIT 20
```

---

## 5. API Endpoints

### 5.1 Route Factory Setup

**File:** `server/routes/create_server_route.ts`

```typescript
import { createServerRouteFactory } from '@kbn/server-route-repository';
import type { GroupsRouteHandlerResources } from './types';

export const createServerRoute = createServerRouteFactory<GroupsRouteHandlerResources>();
```

**File:** `server/routes/types.ts`

```typescript
import type { CoreStart, KibanaRequest, Logger } from '@kbn/core/server';
import type { GroupsClient } from '../lib/groups';
import type { MembersClient } from '../lib/members';
import type { ACLService } from '../lib/acl';
import type { AssetResolver } from '../lib/assets';

export interface GroupsRouteHandlerResources {
  request: KibanaRequest;
  logger: Logger;
  core: CoreStart;
  clients: {
    groups: GroupsClient;
    members: MembersClient;
    acl: ACLService;
    assets: AssetResolver;
  };
}
```

### 5.2 Groups Routes

**File:** `server/routes/groups/route.ts`

```typescript
import { z } from '@kbn/zod';
import { createServerRoute } from '../create_server_route';
import { GROUPS_API_PRIVILEGES } from '../../../common/constants';

// POST /api/groups - Create a group
export const createGroupRoute = createServerRoute({
  endpoint: 'POST /api/groups 2024-01-01',
  options: {
    access: 'public',
    summary: 'Create a new group',
  },
  security: {
    authz: {
      requiredPrivileges: [GROUPS_API_PRIVILEGES.manage],
    },
  },
  params: z.object({
    body: z.object({
      name: z.string().min(1).max(255),
      description: z.string().max(1000).optional(),
      metadata: z.record(z.unknown()).optional(),
    }),
  }),
  handler: async ({ params, clients, request }) => {
    const { name, description, metadata } = params.body;
    const userId = request.auth?.user?.id ?? 'unknown';

    const group = await clients.groups.create({
      name,
      description,
      metadata,
      createdBy: userId,
    });

    return { group };
  },
});

// GET /api/groups/{id} - Get a group by ID
export const getGroupRoute = createServerRoute({
  endpoint: 'GET /api/groups/{id} 2024-01-01',
  options: {
    access: 'public',
    summary: 'Get a group by ID',
  },
  security: {
    authz: {
      requiredPrivileges: [GROUPS_API_PRIVILEGES.read],
    },
  },
  params: z.object({
    path: z.object({
      id: z.string(),
    }),
  }),
  handler: async ({ params, clients, request }) => {
    const group = await clients.groups.get(params.path.id);
    
    if (!group) {
      throw new Error('Group not found');
    }

    // Check ACL
    const userId = request.auth?.user?.id ?? 'unknown';
    const hasAccess = await clients.acl.checkAccess(group, userId, 'read');
    
    if (!hasAccess) {
      throw new Error('Access denied');
    }

    return { group };
  },
});

// GET /api/groups - List/search groups
export const listGroupsRoute = createServerRoute({
  endpoint: 'GET /api/groups 2024-01-01',
  options: {
    access: 'public',
    summary: 'List or search groups',
  },
  security: {
    authz: {
      requiredPrivileges: [GROUPS_API_PRIVILEGES.read],
    },
  },
  params: z.object({
    query: z.object({
      name: z.string().optional(),
      from: z.coerce.number().optional(),
      size: z.coerce.number().optional(),
    }),
  }),
  handler: async ({ params, clients, request }) => {
    const userId = request.auth?.user?.id ?? 'unknown';
    
    const result = await clients.groups.search({
      name: params.query.name,
      from: params.query.from,
      size: params.query.size,
    });

    // Filter by ACL
    const accessibleGroups = await Promise.all(
      result.groups.map(async (group) => {
        const hasAccess = await clients.acl.checkAccess(group, userId, 'read');
        return hasAccess ? group : null;
      })
    );

    return {
      groups: accessibleGroups.filter(Boolean),
      total: result.total,
    };
  },
});

// PUT /api/groups/{id} - Update a group
export const updateGroupRoute = createServerRoute({
  endpoint: 'PUT /api/groups/{id} 2024-01-01',
  options: {
    access: 'public',
    summary: 'Update a group',
  },
  security: {
    authz: {
      requiredPrivileges: [GROUPS_API_PRIVILEGES.manage],
    },
  },
  params: z.object({
    path: z.object({
      id: z.string(),
    }),
    body: z.object({
      name: z.string().min(1).max(255).optional(),
      description: z.string().max(1000).optional(),
      metadata: z.record(z.unknown()).optional(),
    }),
  }),
  handler: async ({ params, clients, request }) => {
    const group = await clients.groups.get(params.path.id);
    
    if (!group) {
      throw new Error('Group not found');
    }

    const userId = request.auth?.user?.id ?? 'unknown';
    const hasAccess = await clients.acl.checkAccess(group, userId, 'write');
    
    if (!hasAccess) {
      throw new Error('Access denied');
    }

    const updated = await clients.groups.update(params.path.id, params.body);
    return { group: updated };
  },
});

// DELETE /api/groups/{id} - Delete a group
export const deleteGroupRoute = createServerRoute({
  endpoint: 'DELETE /api/groups/{id} 2024-01-01',
  options: {
    access: 'public',
    summary: 'Delete a group',
  },
  security: {
    authz: {
      requiredPrivileges: [GROUPS_API_PRIVILEGES.manage],
    },
  },
  params: z.object({
    path: z.object({
      id: z.string(),
    }),
  }),
  handler: async ({ params, clients, request }) => {
    const group = await clients.groups.get(params.path.id);
    
    if (!group) {
      throw new Error('Group not found');
    }

    const userId = request.auth?.user?.id ?? 'unknown';
    const hasAccess = await clients.acl.checkAccess(group, userId, 'admin');
    
    if (!hasAccess) {
      throw new Error('Access denied');
    }

    // Remove all members first
    await clients.members.removeAllByGroup(params.path.id);
    
    // Delete the group
    await clients.groups.delete(params.path.id);
    
    return { success: true };
  },
});

export const groupsRoutes = {
  ...createGroupRoute,
  ...getGroupRoute,
  ...listGroupsRoute,
  ...updateGroupRoute,
  ...deleteGroupRoute,
};
```

### 5.3 Members Routes

**File:** `server/routes/members/route.ts`

```typescript
import { z } from '@kbn/zod';
import { createServerRoute } from '../create_server_route';
import { GROUPS_API_PRIVILEGES } from '../../../common/constants';

// POST /api/groups/{id}/members - Add member to group
export const addMemberRoute = createServerRoute({
  endpoint: 'POST /api/groups/{id}/members 2024-01-01',
  options: {
    access: 'public',
    summary: 'Add a member to a group',
  },
  security: {
    authz: {
      requiredPrivileges: [GROUPS_API_PRIVILEGES.manage],
    },
  },
  params: z.object({
    path: z.object({
      id: z.string(),
    }),
    body: z.object({
      assetType: z.enum([
        'dashboard',
        'rule',
        'slo',
        'data_view',
        'saved_search',
        'ingest_pipeline',
        'index_template',
        'stream',
      ]),
      assetId: z.string(),
    }),
  }),
  handler: async ({ params, clients, request }) => {
    const group = await clients.groups.get(params.path.id);
    
    if (!group) {
      throw new Error('Group not found');
    }

    const userId = request.auth?.user?.id ?? 'unknown';
    const hasAccess = await clients.acl.checkAccess(group, userId, 'write');
    
    if (!hasAccess) {
      throw new Error('Access denied');
    }

    // Validate asset exists
    const assetExists = await clients.assets.exists(
      params.body.assetType,
      params.body.assetId
    );
    
    if (!assetExists) {
      throw new Error(`Asset not found: ${params.body.assetType}/${params.body.assetId}`);
    }

    const member = await clients.members.add({
      groupId: params.path.id,
      assetType: params.body.assetType,
      assetId: params.body.assetId,
      addedBy: userId,
    });

    return { member };
  },
});

// GET /api/groups/{id}/members - List members of a group
export const listMembersRoute = createServerRoute({
  endpoint: 'GET /api/groups/{id}/members 2024-01-01',
  options: {
    access: 'public',
    summary: 'List members of a group',
  },
  security: {
    authz: {
      requiredPrivileges: [GROUPS_API_PRIVILEGES.read],
    },
  },
  params: z.object({
    path: z.object({
      id: z.string(),
    }),
    query: z.object({
      assetType: z.string().optional(),
      from: z.coerce.number().optional(),
      size: z.coerce.number().optional(),
      includeDetails: z.coerce.boolean().optional(),
    }),
  }),
  handler: async ({ params, clients, request }) => {
    const group = await clients.groups.get(params.path.id);
    
    if (!group) {
      throw new Error('Group not found');
    }

    const userId = request.auth?.user?.id ?? 'unknown';
    const hasAccess = await clients.acl.checkAccess(group, userId, 'read');
    
    if (!hasAccess) {
      throw new Error('Access denied');
    }

    const result = await clients.members.getByGroup(params.path.id, {
      assetType: params.query.assetType,
      from: params.query.from,
      size: params.query.size,
    });

    // Optionally resolve asset details
    if (params.query.includeDetails) {
      const membersWithDetails = await Promise.all(
        result.members.map(async (member) => {
          const details = await clients.assets.getDetails(
            member.assetType,
            member.assetId
          );
          return { ...member, details };
        })
      );
      return { members: membersWithDetails, total: result.total };
    }

    return result;
  },
});

// DELETE /api/groups/{id}/members/{assetType}/{assetId} - Remove member
export const removeMemberRoute = createServerRoute({
  endpoint: 'DELETE /api/groups/{id}/members/{assetType}/{assetId} 2024-01-01',
  options: {
    access: 'public',
    summary: 'Remove a member from a group',
  },
  security: {
    authz: {
      requiredPrivileges: [GROUPS_API_PRIVILEGES.manage],
    },
  },
  params: z.object({
    path: z.object({
      id: z.string(),
      assetType: z.string(),
      assetId: z.string(),
    }),
  }),
  handler: async ({ params, clients, request }) => {
    const group = await clients.groups.get(params.path.id);
    
    if (!group) {
      throw new Error('Group not found');
    }

    const userId = request.auth?.user?.id ?? 'unknown';
    const hasAccess = await clients.acl.checkAccess(group, userId, 'write');
    
    if (!hasAccess) {
      throw new Error('Access denied');
    }

    await clients.members.remove({
      groupId: params.path.id,
      assetType: params.path.assetType,
      assetId: params.path.assetId,
    });

    return { success: true };
  },
});

// GET /api/groups/_by_asset/{assetType}/{assetId} - Find groups containing asset
export const findGroupsByAssetRoute = createServerRoute({
  endpoint: 'GET /api/groups/_by_asset/{assetType}/{assetId} 2024-01-01',
  options: {
    access: 'public',
    summary: 'Find groups containing a specific asset',
  },
  security: {
    authz: {
      requiredPrivileges: [GROUPS_API_PRIVILEGES.read],
    },
  },
  params: z.object({
    path: z.object({
      assetType: z.string(),
      assetId: z.string(),
    }),
  }),
  handler: async ({ params, clients, request }) => {
    const userId = request.auth?.user?.id ?? 'unknown';
    
    const groupIds = await clients.members.findGroupsContainingAsset(
      params.path.assetType,
      params.path.assetId
    );

    if (groupIds.length === 0) {
      return { groups: [] };
    }

    const result = await clients.groups.search({ ids: groupIds });
    
    // Filter by ACL
    const accessibleGroups = await Promise.all(
      result.groups.map(async (group) => {
        const hasAccess = await clients.acl.checkAccess(group, userId, 'read');
        return hasAccess ? group : null;
      })
    );

    return { groups: accessibleGroups.filter(Boolean) };
  },
});

export const membersRoutes = {
  ...addMemberRoute,
  ...listMembersRoute,
  ...removeMemberRoute,
  ...findGroupsByAssetRoute,
};
```

### 5.4 ACL Routes

**File:** `server/routes/acl/route.ts`

```typescript
import { z } from '@kbn/zod';
import { createServerRoute } from '../create_server_route';
import { GROUPS_API_PRIVILEGES } from '../../../common/constants';

// PUT /api/groups/{id}/acl - Update group ACL
export const updateACLRoute = createServerRoute({
  endpoint: 'PUT /api/groups/{id}/acl 2024-01-01',
  options: {
    access: 'public',
    summary: 'Update group access control list',
  },
  security: {
    authz: {
      requiredPrivileges: [GROUPS_API_PRIVILEGES.manage],
    },
  },
  params: z.object({
    path: z.object({
      id: z.string(),
    }),
    body: z.object({
      permissions: z.array(z.object({
        principal: z.object({
          type: z.enum(['user', 'role']),
          id: z.string(),
        }),
        access: z.enum(['read', 'write', 'admin']),
      })),
    }),
  }),
  handler: async ({ params, clients, request }) => {
    const group = await clients.groups.get(params.path.id);
    
    if (!group) {
      throw new Error('Group not found');
    }

    const userId = request.auth?.user?.id ?? 'unknown';
    const hasAccess = await clients.acl.checkAccess(group, userId, 'admin');
    
    if (!hasAccess) {
      throw new Error('Access denied - admin permission required');
    }

    const updatedGroup = await clients.groups.update(params.path.id, {
      acl: {
        ...group.acl,
        permissions: params.body.permissions,
      },
    });

    return { group: updatedGroup };
  },
});

// GET /api/groups/{id}/acl - Get group ACL
export const getACLRoute = createServerRoute({
  endpoint: 'GET /api/groups/{id}/acl 2024-01-01',
  options: {
    access: 'public',
    summary: 'Get group access control list',
  },
  security: {
    authz: {
      requiredPrivileges: [GROUPS_API_PRIVILEGES.read],
    },
  },
  params: z.object({
    path: z.object({
      id: z.string(),
    }),
  }),
  handler: async ({ params, clients, request }) => {
    const group = await clients.groups.get(params.path.id);
    
    if (!group) {
      throw new Error('Group not found');
    }

    const userId = request.auth?.user?.id ?? 'unknown';
    const hasAccess = await clients.acl.checkAccess(group, userId, 'read');
    
    if (!hasAccess) {
      throw new Error('Access denied');
    }

    return { acl: group.acl };
  },
});

export const aclRoutes = {
  ...updateACLRoute,
  ...getACLRoute,
};
```

### 5.5 API Summary Table

| Method | Endpoint | Description | Privilege |
|--------|----------|-------------|-----------|
| POST | `/api/groups` | Create a new group | `manage_group` |
| GET | `/api/groups` | List/search groups | `read_group` |
| GET | `/api/groups/{id}` | Get group by ID | `read_group` |
| PUT | `/api/groups/{id}` | Update group | `manage_group` |
| DELETE | `/api/groups/{id}` | Delete group | `manage_group` |
| POST | `/api/groups/{id}/members` | Add member to group | `manage_group` |
| GET | `/api/groups/{id}/members` | List group members | `read_group` |
| DELETE | `/api/groups/{id}/members/{type}/{id}` | Remove member | `manage_group` |
| GET | `/api/groups/_by_asset/{type}/{id}` | Find groups by asset | `read_group` |
| GET | `/api/groups/{id}/acl` | Get group ACL | `read_group` |
| PUT | `/api/groups/{id}/acl` | Update group ACL | `manage_group` |

---

## 6. Access Control (ACL)

### 6.1 Constants

**File:** `common/constants.ts`

```typescript
export const GROUPS_FEATURE_ID = 'groups';

export const GROUPS_API_PRIVILEGES = {
  read: 'read_group',
  manage: 'manage_group',
} as const;

export const GROUPS_UI_PRIVILEGES = {
  show: 'show',
  manage: 'manage',
} as const;

export const ACL_ACCESS_LEVELS = ['read', 'write', 'admin'] as const;
export type ACLAccessLevel = typeof ACL_ACCESS_LEVELS[number];
```

### 6.2 ACL Service

**File:** `server/lib/acl/acl_service.ts`

```typescript
import type { KibanaRequest, SecurityServiceStart } from '@kbn/core/server';
import type { Group, GroupACL, ACLAccessLevel } from '../../common/types';

export class ACLService {
  constructor(
    private readonly security: SecurityServiceStart,
    private readonly request: KibanaRequest
  ) {}

  /**
   * Check if the current user has the specified access level to a group.
   * 
   * Access hierarchy: admin > write > read
   * - admin includes write and read
   * - write includes read
   */
  async checkAccess(
    group: Group,
    userId: string,
    requiredAccess: ACLAccessLevel
  ): Promise<boolean> {
    const { acl } = group;

    // Owner always has admin access
    if (acl.owner === userId) {
      return true;
    }

    // Get user's roles
    const userRoles = await this.getUserRoles();

    // Check permissions
    for (const permission of acl.permissions) {
      const matches = this.matchesPrincipal(permission.principal, userId, userRoles);
      
      if (matches && this.accessLevelSatisfies(permission.access, requiredAccess)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get the effective access level for a user on a group
   */
  async getEffectiveAccess(
    group: Group,
    userId: string
  ): Promise<ACLAccessLevel | null> {
    const { acl } = group;

    // Owner always has admin access
    if (acl.owner === userId) {
      return 'admin';
    }

    const userRoles = await this.getUserRoles();
    let highestAccess: ACLAccessLevel | null = null;

    for (const permission of acl.permissions) {
      const matches = this.matchesPrincipal(permission.principal, userId, userRoles);
      
      if (matches) {
        if (permission.access === 'admin') {
          return 'admin'; // Highest possible, return immediately
        }
        if (permission.access === 'write' && highestAccess !== 'admin') {
          highestAccess = 'write';
        }
        if (permission.access === 'read' && !highestAccess) {
          highestAccess = 'read';
        }
      }
    }

    return highestAccess;
  }

  private matchesPrincipal(
    principal: { type: 'user' | 'role'; id: string },
    userId: string,
    userRoles: string[]
  ): boolean {
    if (principal.type === 'user') {
      return principal.id === userId;
    }
    if (principal.type === 'role') {
      return userRoles.includes(principal.id);
    }
    return false;
  }

  private accessLevelSatisfies(
    grantedAccess: ACLAccessLevel,
    requiredAccess: ACLAccessLevel
  ): boolean {
    const hierarchy: Record<ACLAccessLevel, number> = {
      read: 1,
      write: 2,
      admin: 3,
    };
    return hierarchy[grantedAccess] >= hierarchy[requiredAccess];
  }

  private async getUserRoles(): Promise<string[]> {
    const authc = this.security.authc.getCurrentUser(this.request);
    return authc?.roles ?? [];
  }
}
```

### 6.3 Feature Registration

**File:** `server/plugin.ts` (feature registration section)

```typescript
import { GROUPS_FEATURE_ID, GROUPS_API_PRIVILEGES, GROUPS_UI_PRIVILEGES } from '../common/constants';

// In setup():
plugins.features.registerKibanaFeature({
  id: GROUPS_FEATURE_ID,
  name: 'Groups',
  order: 700,
  category: DEFAULT_APP_CATEGORIES.management,
  app: [GROUPS_FEATURE_ID],
  privileges: {
    all: {
      app: [GROUPS_FEATURE_ID],
      savedObject: {
        all: [],
        read: [],
      },
      api: [GROUPS_API_PRIVILEGES.read, GROUPS_API_PRIVILEGES.manage],
      ui: [GROUPS_UI_PRIVILEGES.show, GROUPS_UI_PRIVILEGES.manage],
    },
    read: {
      app: [GROUPS_FEATURE_ID],
      savedObject: {
        all: [],
        read: [],
      },
      api: [GROUPS_API_PRIVILEGES.read],
      ui: [GROUPS_UI_PRIVILEGES.show],
    },
  },
});
```

---

## 7. Embeddables

### 7.1 Overview

Two custom embeddables for dashboard landing pages:

| Embeddable | Purpose | State |
|------------|---------|-------|
| `GROUP_INFO_EMBEDDABLE` | Display group name, description, metadata | `groupId` |
| `GROUP_DASHBOARD_LIST_EMBEDDABLE` | List dashboards in group as links | `groupId` |

### 7.2 Group Info Embeddable

**File:** `public/embeddables/group_info/constants.ts`

```typescript
export const GROUP_INFO_EMBEDDABLE_ID = 'GROUP_INFO_EMBEDDABLE';
```

**File:** `public/embeddables/group_info/types.ts`

```typescript
import type { DefaultEmbeddableApi } from '@kbn/embeddable-plugin/public';
import type { PublishesWritableTitle, SerializedTitles } from '@kbn/presentation-publishing';

export interface GroupInfoEmbeddableState {
  groupId: string;
}

export type GroupInfoSerializedState = SerializedTitles & GroupInfoEmbeddableState;

export type GroupInfoApi = DefaultEmbeddableApi<GroupInfoSerializedState> &
  PublishesWritableTitle;
```

**File:** `public/embeddables/group_info/group_info_embeddable_factory.tsx`

```typescript
import React, { useEffect, useState } from 'react';
import { EuiText, EuiTitle, EuiSpacer, EuiLoadingSpinner, EuiCallOut } from '@elastic/eui';
import type { EmbeddableFactory } from '@kbn/embeddable-plugin/public';
import { initializeUnsavedChanges } from '@kbn/presentation-containers';
import type { StateComparators, WithAllKeys } from '@kbn/presentation-publishing';
import {
  initializeStateManager,
  initializeTitleManager,
  titleComparators,
  useBatchedPublishingSubjects,
} from '@kbn/presentation-publishing';
import { BehaviorSubject, merge, map } from 'rxjs';
import { GROUP_INFO_EMBEDDABLE_ID } from './constants';
import type { GroupInfoApi, GroupInfoEmbeddableState, GroupInfoSerializedState } from './types';
import type { Group } from '../../../common/types';
import type { GroupsPluginStartDeps } from '../../types';

const defaultState: WithAllKeys<GroupInfoEmbeddableState> = {
  groupId: '',
};

const stateComparators: StateComparators<GroupInfoEmbeddableState> = {
  groupId: 'referenceEquality',
};

export const getGroupInfoEmbeddableFactory = (
  deps: GroupsPluginStartDeps
): EmbeddableFactory<GroupInfoSerializedState, GroupInfoApi> => ({
  type: GROUP_INFO_EMBEDDABLE_ID,
  buildEmbeddable: async ({ initialState, finalizeApi, parentApi, uuid }) => {
    const titleManager = initializeTitleManager(initialState.rawState);
    const stateManager = initializeStateManager(initialState.rawState, defaultState);

    const serializeState = () => ({
      rawState: {
        ...titleManager.getLatestState(),
        ...stateManager.getLatestState(),
      },
    });

    const unsavedChangesApi = initializeUnsavedChanges({
      uuid,
      parentApi,
      serializeState,
      anyStateChange$: merge(
        titleManager.anyStateChange$,
        stateManager.anyStateChange$
      ).pipe(map(() => undefined)),
      getComparators: () => ({ ...titleComparators, ...stateComparators }),
      onReset: (lastSaved) => {
        titleManager.reinitializeState(lastSaved?.rawState);
        stateManager.reinitializeState(lastSaved?.rawState);
      },
    });

    const api = finalizeApi({
      ...unsavedChangesApi,
      ...titleManager.api,
      serializeState,
      getTypeDisplayName: () => 'Group Info',
    });

    return {
      api,
      Component: function GroupInfoComponent() {
        const [groupId] = useBatchedPublishingSubjects(stateManager.api.groupId$);
        const [group, setGroup] = useState<Group | null>(null);
        const [loading, setLoading] = useState(true);
        const [error, setError] = useState<string | null>(null);

        useEffect(() => {
          if (!groupId) {
            setLoading(false);
            setError('No group ID provided');
            return;
          }

          const fetchGroup = async () => {
            try {
              setLoading(true);
              const response = await deps.http.get<{ group: Group }>(
                `/api/groups/${groupId}`,
                { version: '2024-01-01' }
              );
              setGroup(response.group);
              setError(null);
            } catch (e) {
              setError(e.message || 'Failed to load group');
            } finally {
              setLoading(false);
            }
          };

          fetchGroup();
        }, [groupId]);

        if (loading) {
          return <EuiLoadingSpinner size="l" />;
        }

        if (error) {
          return <EuiCallOut title="Error" color="danger">{error}</EuiCallOut>;
        }

        if (!group) {
          return <EuiCallOut title="Not Found">Group not found</EuiCallOut>;
        }

        return (
          <div style={{ padding: '16px' }}>
            <EuiTitle size="l">
              <h1>{group.name}</h1>
            </EuiTitle>
            {group.description && (
              <>
                <EuiSpacer size="m" />
                <EuiText>
                  <p>{group.description}</p>
                </EuiText>
              </>
            )}
            <EuiSpacer size="s" />
            <EuiText size="xs" color="subdued">
              Created: {new Date(group.createdAt).toLocaleDateString()}
            </EuiText>
          </div>
        );
      },
    };
  },
});
```

### 7.3 Dashboard List Embeddable

**File:** `public/embeddables/dashboard_list/constants.ts`

```typescript
export const GROUP_DASHBOARD_LIST_EMBEDDABLE_ID = 'GROUP_DASHBOARD_LIST_EMBEDDABLE';
```

**File:** `public/embeddables/dashboard_list/types.ts`

```typescript
import type { DefaultEmbeddableApi } from '@kbn/embeddable-plugin/public';
import type { PublishesWritableTitle, SerializedTitles } from '@kbn/presentation-publishing';

export interface GroupDashboardListEmbeddableState {
  groupId: string;
  maxItems?: number;
}

export type GroupDashboardListSerializedState = SerializedTitles & GroupDashboardListEmbeddableState;

export type GroupDashboardListApi = DefaultEmbeddableApi<GroupDashboardListSerializedState> &
  PublishesWritableTitle;
```

**File:** `public/embeddables/dashboard_list/dashboard_list_embeddable_factory.tsx`

```typescript
import React, { useEffect, useState } from 'react';
import {
  EuiListGroup,
  EuiListGroupItem,
  EuiLoadingSpinner,
  EuiCallOut,
  EuiEmptyPrompt,
  EuiIcon,
} from '@elastic/eui';
import type { EmbeddableFactory } from '@kbn/embeddable-plugin/public';
import { initializeUnsavedChanges } from '@kbn/presentation-containers';
import type { StateComparators, WithAllKeys } from '@kbn/presentation-publishing';
import {
  initializeStateManager,
  initializeTitleManager,
  titleComparators,
  useBatchedPublishingSubjects,
} from '@kbn/presentation-publishing';
import { merge, map } from 'rxjs';
import { GROUP_DASHBOARD_LIST_EMBEDDABLE_ID } from './constants';
import type {
  GroupDashboardListApi,
  GroupDashboardListEmbeddableState,
  GroupDashboardListSerializedState,
} from './types';
import type { Member } from '../../../common/types';
import type { GroupsPluginStartDeps } from '../../types';

interface DashboardDetails {
  id: string;
  title: string;
  description?: string;
}

interface MemberWithDetails extends Member {
  details?: DashboardDetails;
}

const defaultState: WithAllKeys<GroupDashboardListEmbeddableState> = {
  groupId: '',
  maxItems: 10,
};

const stateComparators: StateComparators<GroupDashboardListEmbeddableState> = {
  groupId: 'referenceEquality',
  maxItems: 'referenceEquality',
};

export const getGroupDashboardListEmbeddableFactory = (
  deps: GroupsPluginStartDeps
): EmbeddableFactory<GroupDashboardListSerializedState, GroupDashboardListApi> => ({
  type: GROUP_DASHBOARD_LIST_EMBEDDABLE_ID,
  buildEmbeddable: async ({ initialState, finalizeApi, parentApi, uuid }) => {
    const titleManager = initializeTitleManager(initialState.rawState);
    const stateManager = initializeStateManager(initialState.rawState, defaultState);

    const serializeState = () => ({
      rawState: {
        ...titleManager.getLatestState(),
        ...stateManager.getLatestState(),
      },
    });

    const unsavedChangesApi = initializeUnsavedChanges({
      uuid,
      parentApi,
      serializeState,
      anyStateChange$: merge(
        titleManager.anyStateChange$,
        stateManager.anyStateChange$
      ).pipe(map(() => undefined)),
      getComparators: () => ({ ...titleComparators, ...stateComparators }),
      onReset: (lastSaved) => {
        titleManager.reinitializeState(lastSaved?.rawState);
        stateManager.reinitializeState(lastSaved?.rawState);
      },
    });

    const api = finalizeApi({
      ...unsavedChangesApi,
      ...titleManager.api,
      serializeState,
      getTypeDisplayName: () => 'Group Dashboard List',
    });

    return {
      api,
      Component: function GroupDashboardListComponent() {
        const [groupId, maxItems] = useBatchedPublishingSubjects(
          stateManager.api.groupId$,
          stateManager.api.maxItems$
        );
        const [dashboards, setDashboards] = useState<MemberWithDetails[]>([]);
        const [loading, setLoading] = useState(true);
        const [error, setError] = useState<string | null>(null);

        useEffect(() => {
          if (!groupId) {
            setLoading(false);
            setError('No group ID provided');
            return;
          }

          const fetchDashboards = async () => {
            try {
              setLoading(true);
              const response = await deps.http.get<{ 
                members: MemberWithDetails[]; 
                total: number;
              }>(
                `/api/groups/${groupId}/members`,
                {
                  version: '2024-01-01',
                  query: {
                    assetType: 'dashboard',
                    size: maxItems || 10,
                    includeDetails: true,
                  },
                }
              );
              setDashboards(response.members);
              setError(null);
            } catch (e) {
              setError(e.message || 'Failed to load dashboards');
            } finally {
              setLoading(false);
            }
          };

          fetchDashboards();
        }, [groupId, maxItems]);

        if (loading) {
          return (
            <div style={{ padding: '16px', textAlign: 'center' }}>
              <EuiLoadingSpinner size="l" />
            </div>
          );
        }

        if (error) {
          return <EuiCallOut title="Error" color="danger">{error}</EuiCallOut>;
        }

        if (dashboards.length === 0) {
          return (
            <EuiEmptyPrompt
              iconType="dashboardApp"
              title={<h3>No dashboards</h3>}
              body={<p>This group has no dashboards yet.</p>}
            />
          );
        }

        return (
          <EuiListGroup flush>
            {dashboards.map((dashboard) => (
              <EuiListGroupItem
                key={dashboard.id}
                icon={<EuiIcon type="dashboardApp" />}
                label={dashboard.details?.title || dashboard.assetId}
                href={`/app/dashboards#/view/${dashboard.assetId}`}
                extraAction={{
                  iconType: 'popout',
                  alwaysShow: true,
                  'aria-label': 'Open dashboard',
                }}
              />
            ))}
          </EuiListGroup>
        );
      },
    };
  },
});
```

### 7.4 Plugin Registration

**File:** `public/plugin.ts`

```typescript
import type { CoreSetup, CoreStart, Plugin } from '@kbn/core/public';
import type { EmbeddableSetup } from '@kbn/embeddable-plugin/public';
import { GROUP_INFO_EMBEDDABLE_ID } from './embeddables/group_info/constants';
import { GROUP_DASHBOARD_LIST_EMBEDDABLE_ID } from './embeddables/dashboard_list/constants';

export interface GroupsPluginSetupDeps {
  embeddable: EmbeddableSetup;
}

export interface GroupsPluginStartDeps {
  http: CoreStart['http'];
}

export class GroupsPlugin implements Plugin<void, void, GroupsPluginSetupDeps, GroupsPluginStartDeps> {
  public setup(core: CoreSetup<GroupsPluginStartDeps>, plugins: GroupsPluginSetupDeps) {
    // Register Group Info embeddable
    plugins.embeddable.registerReactEmbeddableFactory(
      GROUP_INFO_EMBEDDABLE_ID,
      async () => {
        const [coreStart] = await core.getStartServices();
        const { getGroupInfoEmbeddableFactory } = await import(
          './embeddables/group_info/group_info_embeddable_factory'
        );
        return getGroupInfoEmbeddableFactory({ http: coreStart.http });
      }
    );

    // Register Dashboard List embeddable
    plugins.embeddable.registerReactEmbeddableFactory(
      GROUP_DASHBOARD_LIST_EMBEDDABLE_ID,
      async () => {
        const [coreStart] = await core.getStartServices();
        const { getGroupDashboardListEmbeddableFactory } = await import(
          './embeddables/dashboard_list/dashboard_list_embeddable_factory'
        );
        return getGroupDashboardListEmbeddableFactory({ http: coreStart.http });
      }
    );
  }

  public start(core: CoreStart) {
    return {};
  }

  public stop() {}
}
```

---

## 8. Testing

### 8.1 Test Structure

```
x-pack/platform/test/api_integration_deployment_agnostic/apis/groups/
├── config.stateful.ts
├── config.serverless.ts
├── index.ts
├── groups.ts
├── members.ts
└── acl.ts
```

### 8.2 FTR Test Configuration

**File:** `x-pack/platform/test/api_integration_deployment_agnostic/apis/groups/config.stateful.ts`

```typescript
import { createStatefulTestConfig } from '../../create_stateful_test_config';

export default createStatefulTestConfig({
  testFiles: [require.resolve('./index.ts')],
  junit: {
    reportName: 'Groups API Integration Tests - Stateful',
  },
});
```

### 8.3 Groups API Tests

**File:** `x-pack/platform/test/api_integration_deployment_agnostic/apis/groups/groups.ts`

```typescript
import expect from '@kbn/expect';
import type { DeploymentAgnosticFtrProviderContext } from '../../ftr_provider_context';

export default function groupsApiTests({ getService }: DeploymentAgnosticFtrProviderContext) {
  const supertest = getService('supertest');
  const log = getService('log');

  describe('Groups API', () => {
    let createdGroupId: string;

    describe('POST /api/groups', () => {
      it('should create a new group', async () => {
        const response = await supertest
          .post('/api/groups')
          .set('kbn-xsrf', 'true')
          .set('elastic-api-version', '2024-01-01')
          .send({
            name: 'Test Group',
            description: 'A test group for integration testing',
            metadata: { environment: 'test' },
          })
          .expect(200);

        expect(response.body.group).to.have.property('id');
        expect(response.body.group.name).to.be('Test Group');
        expect(response.body.group.description).to.be('A test group for integration testing');
        
        createdGroupId = response.body.group.id;
        log.info(`Created group: ${createdGroupId}`);
      });

      it('should reject invalid group names', async () => {
        await supertest
          .post('/api/groups')
          .set('kbn-xsrf', 'true')
          .set('elastic-api-version', '2024-01-01')
          .send({
            name: '', // Empty name
          })
          .expect(400);
      });
    });

    describe('GET /api/groups/{id}', () => {
      it('should return the created group', async () => {
        const response = await supertest
          .get(`/api/groups/${createdGroupId}`)
          .set('elastic-api-version', '2024-01-01')
          .expect(200);

        expect(response.body.group.id).to.be(createdGroupId);
        expect(response.body.group.name).to.be('Test Group');
      });

      it('should return 404 for non-existent group', async () => {
        await supertest
          .get('/api/groups/non-existent-id')
          .set('elastic-api-version', '2024-01-01')
          .expect(404);
      });
    });

    describe('GET /api/groups', () => {
      it('should list groups', async () => {
        const response = await supertest
          .get('/api/groups')
          .set('elastic-api-version', '2024-01-01')
          .expect(200);

        expect(response.body.groups).to.be.an('array');
        expect(response.body.groups.length).to.be.greaterThan(0);
      });

      it('should filter groups by name', async () => {
        const response = await supertest
          .get('/api/groups')
          .query({ name: 'Test' })
          .set('elastic-api-version', '2024-01-01')
          .expect(200);

        expect(response.body.groups).to.be.an('array');
        response.body.groups.forEach((group: any) => {
          expect(group.name.toLowerCase()).to.contain('test');
        });
      });
    });

    describe('PUT /api/groups/{id}', () => {
      it('should update the group', async () => {
        const response = await supertest
          .put(`/api/groups/${createdGroupId}`)
          .set('kbn-xsrf', 'true')
          .set('elastic-api-version', '2024-01-01')
          .send({
            name: 'Updated Test Group',
            description: 'Updated description',
          })
          .expect(200);

        expect(response.body.group.name).to.be('Updated Test Group');
        expect(response.body.group.description).to.be('Updated description');
      });
    });

    describe('DELETE /api/groups/{id}', () => {
      it('should delete the group', async () => {
        await supertest
          .delete(`/api/groups/${createdGroupId}`)
          .set('kbn-xsrf', 'true')
          .set('elastic-api-version', '2024-01-01')
          .expect(200);

        // Verify deletion
        await supertest
          .get(`/api/groups/${createdGroupId}`)
          .set('elastic-api-version', '2024-01-01')
          .expect(404);
      });
    });
  });
}
```

### 8.4 Members API Tests

**File:** `x-pack/platform/test/api_integration_deployment_agnostic/apis/groups/members.ts`

```typescript
import expect from '@kbn/expect';
import type { DeploymentAgnosticFtrProviderContext } from '../../ftr_provider_context';

export default function membersApiTests({ getService }: DeploymentAgnosticFtrProviderContext) {
  const supertest = getService('supertest');
  const log = getService('log');

  describe('Members API', () => {
    let groupId: string;
    const testDashboardId = 'test-dashboard-123';

    before(async () => {
      // Create a test group
      const response = await supertest
        .post('/api/groups')
        .set('kbn-xsrf', 'true')
        .set('elastic-api-version', '2024-01-01')
        .send({
          name: 'Members Test Group',
          description: 'Group for testing members API',
        })
        .expect(200);

      groupId = response.body.group.id;
      log.info(`Created test group: ${groupId}`);
    });

    after(async () => {
      // Cleanup: delete the test group
      await supertest
        .delete(`/api/groups/${groupId}`)
        .set('kbn-xsrf', 'true')
        .set('elastic-api-version', '2024-01-01');
    });

    describe('POST /api/groups/{id}/members', () => {
      it('should add a member to the group', async () => {
        const response = await supertest
          .post(`/api/groups/${groupId}/members`)
          .set('kbn-xsrf', 'true')
          .set('elastic-api-version', '2024-01-01')
          .send({
            assetType: 'dashboard',
            assetId: testDashboardId,
          })
          .expect(200);

        expect(response.body.member).to.have.property('id');
        expect(response.body.member.groupId).to.be(groupId);
        expect(response.body.member.assetType).to.be('dashboard');
        expect(response.body.member.assetId).to.be(testDashboardId);
      });

      it('should reject invalid asset types', async () => {
        await supertest
          .post(`/api/groups/${groupId}/members`)
          .set('kbn-xsrf', 'true')
          .set('elastic-api-version', '2024-01-01')
          .send({
            assetType: 'invalid_type',
            assetId: 'some-id',
          })
          .expect(400);
      });
    });

    describe('GET /api/groups/{id}/members', () => {
      it('should list members of the group', async () => {
        const response = await supertest
          .get(`/api/groups/${groupId}/members`)
          .set('elastic-api-version', '2024-01-01')
          .expect(200);

        expect(response.body.members).to.be.an('array');
        expect(response.body.members.length).to.be.greaterThan(0);
      });

      it('should filter members by asset type', async () => {
        const response = await supertest
          .get(`/api/groups/${groupId}/members`)
          .query({ assetType: 'dashboard' })
          .set('elastic-api-version', '2024-01-01')
          .expect(200);

        expect(response.body.members).to.be.an('array');
        response.body.members.forEach((member: any) => {
          expect(member.assetType).to.be('dashboard');
        });
      });
    });

    describe('GET /api/groups/_by_asset/{assetType}/{assetId}', () => {
      it('should find groups containing the asset', async () => {
        const response = await supertest
          .get(`/api/groups/_by_asset/dashboard/${testDashboardId}`)
          .set('elastic-api-version', '2024-01-01')
          .expect(200);

        expect(response.body.groups).to.be.an('array');
        expect(response.body.groups.some((g: any) => g.id === groupId)).to.be(true);
      });
    });

    describe('DELETE /api/groups/{id}/members/{assetType}/{assetId}', () => {
      it('should remove the member from the group', async () => {
        await supertest
          .delete(`/api/groups/${groupId}/members/dashboard/${testDashboardId}`)
          .set('kbn-xsrf', 'true')
          .set('elastic-api-version', '2024-01-01')
          .expect(200);

        // Verify removal
        const response = await supertest
          .get(`/api/groups/${groupId}/members`)
          .set('elastic-api-version', '2024-01-01')
          .expect(200);

        const dashboardMembers = response.body.members.filter(
          (m: any) => m.assetType === 'dashboard' && m.assetId === testDashboardId
        );
        expect(dashboardMembers.length).to.be(0);
      });
    });
  });
}
```

### 8.5 Unit Tests

**File:** `server/lib/groups/groups_storage_client.test.ts`

```typescript
import { GroupsStorageClient } from './groups_storage_client';
import { elasticsearchServiceMock, loggingSystemMock } from '@kbn/core/server/mocks';

describe('GroupsStorageClient', () => {
  let client: GroupsStorageClient;
  let esClient: ReturnType<typeof elasticsearchServiceMock.createElasticsearchClient>;
  let logger: ReturnType<typeof loggingSystemMock.createLogger>;

  beforeEach(() => {
    esClient = elasticsearchServiceMock.createElasticsearchClient();
    logger = loggingSystemMock.createLogger();
    client = new GroupsStorageClient(esClient, logger);
  });

  describe('create', () => {
    it('should create a group document', async () => {
      esClient.index.mockResolvedValue({ result: 'created' } as any);

      const group = await client.create({
        id: 'test-id',
        name: 'Test Group',
        description: 'Test description',
        createdBy: 'user-123',
      });

      expect(group.id).toBe('test-id');
      expect(group.name).toBe('Test Group');
      expect(esClient.index).toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('should return null for non-existent group', async () => {
      esClient.get.mockRejectedValue({ meta: { statusCode: 404 } });

      const result = await client.get('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('search', () => {
    it('should search groups by name', async () => {
      esClient.search.mockResolvedValue({
        hits: {
          total: { value: 1 },
          hits: [
            {
              _source: {
                id: 'test-id',
                name: 'Test',
                description: '',
                metadata: {},
                acl: { owner: 'user', permissions: [] },
                created_at: '2024-01-01',
                updated_at: '2024-01-01',
                created_by: 'user',
              },
            },
          ],
        },
      } as any);

      const result = await client.search({ name: 'Test' });
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].name).toBe('Test');
    });
  });
});
```

### 8.6 Running Tests

```bash
# Unit tests
yarn test:jest x-pack/platform/plugins/shared/groups

# FTR API tests (stateful)
yarn test:ftr --config x-pack/platform/test/api_integration_deployment_agnostic/apis/groups/config.stateful.ts

# Type check
node scripts/type_check --project x-pack/platform/plugins/shared/groups/tsconfig.json

# Lint
node scripts/eslint --fix x-pack/platform/plugins/shared/groups
```

---

## 9. Implementation Order

### Phase 1: Foundation (Week 1)

| Step | Task | Files |
|------|------|-------|
| 1.1 | Create plugin scaffold | `kibana.jsonc`, `tsconfig.json`, `index.ts` files |
| 1.2 | Define common types | `common/types.ts`, `common/constants.ts`, `common/schemas.ts` |
| 1.3 | Implement groups storage | `server/lib/groups/*` |
| 1.4 | Implement members storage | `server/lib/members/*` |
| 1.5 | Create server plugin class | `server/plugin.ts` |

### Phase 2: API Routes (Week 2)

| Step | Task | Files |
|------|------|-------|
| 2.1 | Route factory setup | `server/routes/create_server_route.ts`, `server/routes/types.ts` |
| 2.2 | Groups CRUD routes | `server/routes/groups/route.ts` |
| 2.3 | Members routes | `server/routes/members/route.ts` |
| 2.4 | Register routes | `server/routes/index.ts` |
| 2.5 | Write API unit tests | `server/routes/**/*.test.ts` |

### Phase 3: ACL System (Week 3)

| Step | Task | Files |
|------|------|-------|
| 3.1 | ACL service implementation | `server/lib/acl/acl_service.ts` |
| 3.2 | ACL routes | `server/routes/acl/route.ts` |
| 3.3 | Feature registration | Update `server/plugin.ts` |
| 3.4 | ACL tests | `server/lib/acl/*.test.ts` |

### Phase 4: Asset Handlers (Week 3-4)

| Step | Task | Files |
|------|------|-------|
| 4.1 | Asset resolver interface | `server/lib/assets/types.ts` |
| 4.2 | Saved Object handler | `server/lib/assets/handlers/saved_object_handler.ts` |
| 4.3 | ES native handler | `server/lib/assets/handlers/es_native_handler.ts` |
| 4.4 | Streams handler | `server/lib/assets/handlers/streams_handler.ts` |
| 4.5 | Asset resolver | `server/lib/assets/asset_resolver.ts` |

### Phase 5: Embeddables (Week 4)

| Step | Task | Files |
|------|------|-------|
| 5.1 | Create public plugin | `public/plugin.ts`, `public/index.ts` |
| 5.2 | Group Info embeddable | `public/embeddables/group_info/*` |
| 5.3 | Dashboard List embeddable | `public/embeddables/dashboard_list/*` |
| 5.4 | Register embeddables | Update `public/plugin.ts` |
| 5.5 | Embeddable tests | `public/embeddables/**/*.test.tsx` |

### Phase 6: Integration Testing (Week 5)

| Step | Task | Files |
|------|------|-------|
| 6.1 | FTR test setup | `x-pack/platform/test/.../groups/config.*.ts` |
| 6.2 | Groups API tests | `x-pack/platform/test/.../groups/groups.ts` |
| 6.3 | Members API tests | `x-pack/platform/test/.../groups/members.ts` |
| 6.4 | ACL tests | `x-pack/platform/test/.../groups/acl.ts` |
| 6.5 | End-to-end validation | All tests passing |

### Phase 7: Documentation & Polish (Week 5)

| Step | Task | Files |
|------|------|-------|
| 7.1 | README documentation | `README.md` |
| 7.2 | API documentation | `docs/api.md` |
| 7.3 | Code cleanup | All files |
| 7.4 | Final verification | Lint, type-check, all tests |

---

## 10. Verification Commands

After each implementation phase, run these verification commands:

```bash
# Bootstrap (if dependencies changed)
yarn kbn bootstrap

# Lint changed files
node scripts/eslint --fix x-pack/platform/plugins/shared/groups

# Type check
node scripts/type_check --project x-pack/platform/plugins/shared/groups/tsconfig.json

# Unit tests
yarn test:jest x-pack/platform/plugins/shared/groups

# FTR tests (after Phase 6)
yarn test:ftr --config x-pack/platform/test/api_integration_deployment_agnostic/apis/groups/config.stateful.ts
```

---

## 11. Key Reference Files

These existing files should be referenced during implementation:

| Pattern | Reference File |
|---------|----------------|
| Storage adapter | `/x-pack/platform/plugins/shared/streams/server/lib/streams/storage/streams_storage_client.ts` |
| Attachment pattern | `/x-pack/platform/plugins/shared/streams/server/lib/streams/attachments/attachment_client.ts` |
| Route factory | `/x-pack/platform/plugins/shared/streams/server/routes/create_server_route.ts` |
| Feature registration | `/x-pack/platform/plugins/shared/streams/server/plugin.ts` (lines 180-220) |
| Embeddable factory | `/x-pack/solutions/observability/plugins/slo/public/embeddable/slo/overview/slo_embeddable_factory.tsx` |
| Markdown embeddable | `/src/platform/plugins/shared/dashboard_markdown/public/markdown_embeddable.tsx` |
| FTR tests | `/x-pack/platform/test/api_integration_deployment_agnostic/apis/streams/` |
| Security instructions | `/.github/instructions/security.instructions.md` |

---

## 12. Security Considerations

Per `/.github/instructions/security.instructions.md`:

1. **All routes must have authorization** via `security.authz.requiredPrivileges`
2. **Privilege naming convention**: `<operation>_<subject>` (e.g., `read_group`, `manage_group`)
3. **Use `request.authzResult`** for privilege-based branching (not capabilities)
4. **Per-group ACL** provides additional fine-grained access control on top of feature privileges

---

*End of Implementation Plan*

