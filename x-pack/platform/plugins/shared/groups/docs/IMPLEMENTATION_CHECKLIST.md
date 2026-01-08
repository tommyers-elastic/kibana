# Groups Plugin Implementation Checklist

> **Progress Tracker for Coding Agent**
> 
> This checklist provides granular, incremental steps for implementing the Groups plugin.
> Each step is designed to be completed in isolation with runnable code after completion.
> Validation points (🧪) indicate where to test before proceeding.

---

## How to Use This Checklist

1. **Work through steps sequentially** - each step builds on the previous
2. **Mark steps complete** - change `[ ]` to `[x]` as you finish
3. **Run validation at 🧪 points** - these are natural breakpoints
4. **Start new conversations at 📍 points** - these are context reset points
5. **Reference the IMPLEMENTATION_PLAN.md** for detailed code examples
6. **Reference DESIGN_RATIONALE.md** for architectural decisions

---

## Pre-Implementation Setup

- [x] **Verify branch**: Confirm working on correct branch (`git branch --show-current`)
- [x] **Bootstrap**: Run `nvm use` and `yarn kbn bootstrap` to ensure environment is ready
- [x] **Read instructions**: Review `/Users/tommyers/elastic/kibana/.github/instructions/security.instructions.md`

---

## Phase 1: Plugin Skeleton (📍 Context Reset Point)

**Goal**: Create a minimal plugin that registers and boots successfully.

### 1.1 Create Plugin Directory Structure

- [x] Create directory: `x-pack/platform/plugins/shared/groups/`
- [x] Create directory: `x-pack/platform/plugins/shared/groups/server/`
- [x] Create directory: `x-pack/platform/plugins/shared/groups/public/`
- [x] Create directory: `x-pack/platform/plugins/shared/groups/common/`

### 1.2 Create Plugin Manifest

- [x] Create `x-pack/platform/plugins/shared/groups/kibana.jsonc`:
  ```json
  {
    "type": "plugin",
    "id": "@kbn/groups-plugin",
    "owner": ["@elastic/kibana-core"],
    "group": "platform",
    "visibility": "shared",
    "plugin": {
      "id": "groups",
      "server": true,
      "browser": true,
      "configPath": ["xpack", "groups"],
      "requiredPlugins": ["features"],
      "optionalPlugins": ["security"]
    }
  }
  ```

### 1.3 Create TypeScript Configs

- [x] Create `x-pack/platform/plugins/shared/groups/tsconfig.json` (extend base config)
- [x] Verify tsconfig references parent correctly

### 1.4 Create Server Plugin Entry

- [x] Create `x-pack/platform/plugins/shared/groups/server/index.ts`:
  - Export plugin function
- [x] Create `x-pack/platform/plugins/shared/groups/server/plugin.ts`:
  - Implement `GroupsPlugin` class
  - Empty `setup()` and `start()` methods
  - Log "Groups plugin started" in start()
- [x] Create `x-pack/platform/plugins/shared/groups/server/types.ts`:
  - Define `GroupsPluginSetup` and `GroupsPluginStart` interfaces (empty for now)

### 1.5 Create Public Plugin Entry

- [x] Create `x-pack/platform/plugins/shared/groups/public/index.ts`:
  - Export plugin function
- [x] Create `x-pack/platform/plugins/shared/groups/public/plugin.ts`:
  - Implement `GroupsPlugin` class
  - Empty `setup()` and `start()` methods
- [x] Create `x-pack/platform/plugins/shared/groups/public/types.ts`:
  - Define `GroupsPluginSetup` and `GroupsPluginStart` interfaces (empty for now)

### 1.6 Create Common Types

- [x] Create `x-pack/platform/plugins/shared/groups/common/index.ts`:
  - Export PLUGIN_ID constant: `'groups'`
  - Export PLUGIN_NAME constant: `'Groups'`

### 🧪 Validation Point 1.1: Plugin Boots

```bash
# Start Elasticsearch
yarn es snapshot --license trial

# Start Kibana (in another terminal)
yarn start

# Check logs for "Groups plugin started"
# Verify no errors in console
```

- [ ] Plugin boots without errors
- [ ] "Groups plugin started" appears in logs

### 1.7 Run Verification Commands

```bash
# Lint the new files
node scripts/eslint --fix x-pack/platform/plugins/shared/groups/

# Type check
node scripts/type_check --project x-pack/platform/plugins/shared/groups/tsconfig.json
```

- [x] Linting passes with 0 errors
- [x] Type checking passes with 0 errors
- [x] Commit changes: "feat(groups): add plugin skeleton"

---

## Phase 2: Storage Layer (📍 Context Reset Point)

**Goal**: Create storage indices and client for groups and memberships.

### 2.1 Define Group and Member Types

- [x] Create `x-pack/platform/plugins/shared/groups/common/types.ts`:
  - Define `Group` interface (id, name, description, owner, permissions, metadata, timestamps)
  - Define `GroupMember` interface (groupId, assetType, assetId, addedBy, addedAt)
  - Define `AssetType` union type (dashboard, rule, slo, stream, data_view, etc.)
  - Define `Permission` interface (principal, principalType, level)
  - Define `PermissionLevel` union type (read, write, admin)
- [x] Export all types from `common/index.ts`

### 2.2 Create Index Definitions

- [x] Create `x-pack/platform/plugins/shared/groups/server/lib/storage/index_definitions.ts`:
  - Define `.kibana_groups` index mappings
  - Define `.kibana_groups_members` index mappings
  - Include all fields with proper Elasticsearch types

### 2.3 Create Storage Client

- [x] Create `x-pack/platform/plugins/shared/groups/server/lib/storage/groups_storage_client.ts`:
  - Use `StorageIndexAdapter` from `@kbn/storage-adapter`
  - Implement `createGroup()`, `getGroup()`, `updateGroup()`, `deleteGroup()`
  - Implement `listGroups()` with pagination
- [x] Create `x-pack/platform/plugins/shared/groups/server/lib/storage/members_storage_client.ts`:
  - Use `StorageIndexAdapter` from `@kbn/storage-adapter`
  - Implement `addMember()`, `removeMember()`, `getMembers()`, `getMemberGroups()`
- [x] Create `x-pack/platform/plugins/shared/groups/server/lib/storage/index.ts`:
  - Export both clients

### 2.4 Initialize Storage in Plugin

- [x] Update `server/plugin.ts`:
  - Add `coreSetup.getStartServices()` call
  - Create storage clients in `start()`
  - Store clients on plugin instance

### 🧪 Validation Point 2.1: Storage Layer

```bash
# Lint and type check
node scripts/eslint --fix x-pack/platform/plugins/shared/groups/
node scripts/type_check --project x-pack/platform/plugins/shared/groups/tsconfig.json
```

- [x] Linting passes with 0 errors
- [x] Type checking passes with 0 errors
- [x] Commit changes: "feat(groups): add storage layer"

---

## Phase 3: Basic CRUD APIs (📍 Context Reset Point)

**Goal**: Implement HTTP routes for group CRUD operations.

### 3.1 Create Route Repository Setup

- [x] Create `x-pack/platform/plugins/shared/groups/server/routes/index.ts`:
  - Set up route repository using `@kbn/server-route-repository`
  - Define API version: `2023-10-31` (required for public routes)
- [x] Create `x-pack/platform/plugins/shared/groups/server/routes/types.ts`:
  - Define route handler context types
- [x] Create `x-pack/platform/plugins/shared/groups/server/routes/create_server_route.ts`:
  - Route factory for type-safe route creation

### 3.2 Implement Create Group Route

- [x] Create `x-pack/platform/plugins/shared/groups/server/routes/groups/create.ts`:
  - POST `/api/groups`
  - Request body: name, description (optional), metadata (optional)
  - Returns created group with generated ID
  - Include Zod schema validation
  - Note: Owner set to 'system' for now (TODO: integrate with security plugin)

### 3.3 Implement Get Group Route

- [x] Create `x-pack/platform/plugins/shared/groups/server/routes/groups/get.ts`:
  - GET `/api/groups/{id}`
  - Returns group or 404

### 3.4 Implement List Groups Route

- [x] Create `x-pack/platform/plugins/shared/groups/server/routes/groups/list.ts`:
  - GET `/api/groups`
  - Query params: name (search), from, size
  - Returns paginated list with groups array and total

### 3.5 Implement Update Group Route

- [x] Create `x-pack/platform/plugins/shared/groups/server/routes/groups/update.ts`:
  - PUT `/api/groups/{id}`
  - Partial update of name, description, metadata

### 3.6 Implement Delete Group Route

- [x] Create `x-pack/platform/plugins/shared/groups/server/routes/groups/delete.ts`:
  - DELETE `/api/groups/{id}`
  - Also deletes all memberships for the group

### 3.7 Register Routes

- [x] Create `x-pack/platform/plugins/shared/groups/server/routes/groups/index.ts`:
  - Export all group routes
- [x] Update `server/routes/index.ts`:
  - Export groupsRouteRepository
- [x] Update `server/plugin.ts`:
  - Implement getScopedClients pattern for lazy client initialization
  - Register routes using registerRoutes from @kbn/server-route-repository
- [ ] Update `server/plugin.ts`:
  - Call route registration in `setup()`

### 🧪 Validation Point 3.1: CRUD APIs Work

```bash
# Start ES and Kibana
yarn es snapshot --license trial
yarn start

# Test APIs with curl (in another terminal)
# Create a group
curl -X POST "http://localhost:5601/internal/groups" \
  -H "kbn-xsrf: true" \
  -H "Content-Type: application/json" \
  -d '{"name": "Payment Service Health", "description": "All assets for payment service monitoring"}'

# List groups
curl -X GET "http://localhost:5601/internal/groups" \
  -H "kbn-xsrf: true"

# Get specific group (use ID from create response)
curl -X GET "http://localhost:5601/internal/groups/{id}" \
  -H "kbn-xsrf: true"

# Delete group
curl -X DELETE "http://localhost:5601/internal/groups/{id}" \
  -H "kbn-xsrf: true"
```

- [ ] Create group returns 200 with group object
- [ ] List groups returns paginated results
- [ ] Get group returns the group
- [ ] Delete group returns 200

### 3.8 Run Verification Commands

```bash
node scripts/eslint --fix x-pack/platform/plugins/shared/groups/
node scripts/type_check --project x-pack/platform/plugins/shared/groups/tsconfig.json
```

- [x] Linting passes with 0 errors
- [x] Type checking passes with 0 errors
- [ ] Manual testing (pending - requires starting ES and Kibana)
- [ ] Commit changes: "feat(groups): add CRUD APIs"

---

## Phase 4: Membership APIs (📍 Context Reset Point)

**Goal**: Implement HTTP routes for managing group membership.

### 4.1 Implement Add Member Route

- [ ] Create `x-pack/platform/plugins/shared/groups/server/routes/members/add.ts`:
  - POST `/api/groups/{groupId}/members`
  - Request body: assetType, assetId
  - Validates group exists before adding

### 4.2 Implement Remove Member Route

- [ ] Create `x-pack/platform/plugins/shared/groups/server/routes/members/remove.ts`:
  - DELETE `/api/groups/{groupId}/members/{assetType}/{assetId}`
  - Returns 200 on success, 404 if not found

### 4.3 Implement List Members Route

- [ ] Create `x-pack/platform/plugins/shared/groups/server/routes/members/list.ts`:
  - GET `/api/groups/{groupId}/members`
  - Query params: page, perPage, assetType (filter)
  - Returns paginated list of members

### 4.4 Implement Get Asset Groups Route

- [ ] Create `x-pack/platform/plugins/shared/groups/server/routes/members/asset_groups.ts`:
  - GET `/api/groups/by-asset/{assetType}/{assetId}`
  - Returns all groups an asset belongs to

### 4.5 Implement Bulk Add Members Route

- [ ] Create `x-pack/platform/plugins/shared/groups/server/routes/members/bulk_add.ts`:
  - POST `/api/groups/{groupId}/members/_bulk`
  - Request body: array of {assetType, assetId}
  - Returns success/failure for each

### 4.6 Register Member Routes

- [ ] Create `x-pack/platform/plugins/shared/groups/server/routes/members/index.ts`:
  - Export all member routes
- [ ] Update `server/routes/index.ts`:
  - Import and register member routes

### 🧪 Validation Point 4.1: Membership APIs Work

```bash
# Create a group first
curl -X POST "http://localhost:5601/api/groups" \
  -H "kbn-xsrf: true" \
  -H "Content-Type: application/json" \
  -H "elastic-api-version: 2023-10-31" \
  -u elastic:changeme \
  -d '{"name": "Test Group"}'

# Add a member (use group ID from above)
curl -X POST "http://localhost:5601/api/groups/{groupId}/members" \
  -H "kbn-xsrf: true" \
  -H "Content-Type: application/json" \
  -H "elastic-api-version: 2023-10-31" \
  -u elastic:changeme \
  -d '{"assetType": "dashboard", "assetId": "my-dashboard-id"}'

# List members
curl -X GET "http://localhost:5601/api/groups/{groupId}/members" \
  -H "kbn-xsrf: true" \
  -H "elastic-api-version: 2023-10-31" \
  -u elastic:changeme

# Get groups for an asset
curl -X GET "http://localhost:5601/api/groups/by-asset/dashboard/my-dashboard-id" \
  -H "kbn-xsrf: true" \
  -H "elastic-api-version: 2023-10-31" \
  -u elastic:changeme

# Remove member
curl -X DELETE "http://localhost:5601/api/groups/{groupId}/members/dashboard/my-dashboard-id" \
  -H "kbn-xsrf: true" \
  -H "elastic-api-version: 2023-10-31" \
  -u elastic:changeme
```

- [ ] Add member returns 200
- [ ] List members shows the added member
- [ ] Get asset groups returns the group
- [ ] Remove member returns 200

### 4.7 Run Verification Commands

```bash
node scripts/eslint --fix x-pack/platform/plugins/shared/groups/
node scripts/type_check --project x-pack/platform/plugins/shared/groups/tsconfig.json
```

- [ ] Linting passes with 0 errors
- [ ] Type checking passes with 0 errors
- [ ] Commit changes: "feat(groups): add membership APIs"

---

## Phase 5: Kibana Feature & Basic ACL (📍 Context Reset Point)

**Goal**: Register Kibana feature and implement basic access control.

### 5.1 Register Kibana Feature

- [ ] Create `x-pack/platform/plugins/shared/groups/server/lib/features.ts`:
  - Register feature with `features` plugin
  - Define `read_group` and `manage_group` privileges
  - Configure sub-feature privileges
- [ ] Update `server/plugin.ts`:
  - Call feature registration in `setup()`

### 5.2 Create ACL Service

- [ ] Create `x-pack/platform/plugins/shared/groups/server/lib/acl/acl_service.ts`:
  - Implement `canRead(group, user)` method
  - Implement `canWrite(group, user)` method
  - Implement `canAdmin(group, user)` method
  - Check both Kibana privileges and per-group permissions
- [ ] Create `x-pack/platform/plugins/shared/groups/server/lib/acl/index.ts`:
  - Export ACL service

### 5.3 Integrate ACL into Routes

- [ ] Update all group routes to check permissions:
  - GET routes check `canRead`
  - POST/PUT routes check `canWrite`
  - DELETE routes check `canAdmin`
  - Return 403 if unauthorized

### 🧪 Validation Point 5.1: ACL Works

```bash
# Test with admin user (should work)
curl -X POST "http://localhost:5601/api/groups" \
  -H "kbn-xsrf: true" \
  -H "Content-Type: application/json" \
  -H "elastic-api-version: 2023-10-31" \
  -u elastic:changeme \
  -d '{"name": "Test ACL"}'

# Create a user with limited privileges and test access
# (Manual testing in Kibana UI: Stack Management > Users)
```

- [ ] Admin can create groups
- [ ] ACL checks are enforced on routes

### 5.4 Run Verification Commands

```bash
node scripts/eslint --fix x-pack/platform/plugins/shared/groups/
node scripts/type_check --project x-pack/platform/plugins/shared/groups/tsconfig.json
```

- [ ] Linting passes with 0 errors
- [ ] Type checking passes with 0 errors
- [ ] Commit changes: "feat(groups): add feature registration and ACL"

---

## Phase 6: Public App & Basic UI (📍 Context Reset Point)

**Goal**: Create the Groups management UI with navigation.

### 6.1 Register Application

- [ ] Update `public/plugin.ts`:
  - Register application with `core.application.register()`
  - Set up routing to `/app/groups`
  - Configure navigation category (Observability or Management)

### 6.2 Create App Mount

- [ ] Create `x-pack/platform/plugins/shared/groups/public/application.tsx`:
  - Create React app wrapper
  - Set up React Router
  - Provide Kibana services context
- [ ] Create `x-pack/platform/plugins/shared/groups/public/routes.tsx`:
  - Define routes: `/`, `/:groupId`, `/create`

### 6.3 Create API Client

- [ ] Create `x-pack/platform/plugins/shared/groups/public/services/api_client.ts`:
  - Implement `createGroup()`, `getGroup()`, `listGroups()`, etc.
  - Use `core.http` for requests
  - Handle errors consistently

### 6.4 Create Groups List Page

- [ ] Create `x-pack/platform/plugins/shared/groups/public/pages/groups_list/`:
  - `index.tsx` - Main list page component
  - `groups_table.tsx` - EUI table with pagination
  - `create_group_button.tsx` - Button to navigate to create
  - Fetch and display groups using API client

### 6.5 Create Group Detail Page

- [ ] Create `x-pack/platform/plugins/shared/groups/public/pages/group_detail/`:
  - `index.tsx` - Main detail page
  - `group_header.tsx` - Name, description, edit button
  - `members_list.tsx` - Table of group members
  - `add_member_flyout.tsx` - Flyout to add assets

### 6.6 Create Group Form

- [ ] Create `x-pack/platform/plugins/shared/groups/public/pages/group_form/`:
  - `index.tsx` - Create/edit form
  - Form fields: name, description
  - Validation and submission

### 🧪 Validation Point 6.1: UI Navigation Works

```bash
yarn es snapshot --license trial
yarn start

# Navigate to http://localhost:5601/app/groups
```

- [ ] Groups app loads at `/app/groups`
- [ ] Can navigate between list and detail pages
- [ ] Can create a new group via UI
- [ ] Can view group details

### 6.7 Run Verification Commands

```bash
node scripts/eslint --fix x-pack/platform/plugins/shared/groups/
node scripts/type_check --project x-pack/platform/plugins/shared/groups/tsconfig.json
```

- [ ] Linting passes with 0 errors
- [ ] Type checking passes with 0 errors
- [ ] Commit changes: "feat(groups): add public app and basic UI"

---

## Phase 7: Dashboard Embeddables (📍 Context Reset Point)

**Goal**: Create embeddables for displaying group information on dashboards.

### 7.1 Create Group Info Embeddable

- [ ] Create `x-pack/platform/plugins/shared/groups/public/embeddables/group_info/`:
  - `group_info_embeddable.tsx` - Main embeddable component
  - `group_info_factory.tsx` - Factory registration
  - `group_info_component.tsx` - React component that displays group details
  - Shows: name, description, member count, quick links

### 7.2 Create Dashboard List Embeddable

- [ ] Create `x-pack/platform/plugins/shared/groups/public/embeddables/dashboard_list/`:
  - `dashboard_list_embeddable.tsx` - Main embeddable component
  - `dashboard_list_factory.tsx` - Factory registration
  - `dashboard_list_component.tsx` - Lists dashboards in a group with links
  - Clickable links to open dashboards

### 7.3 Register Embeddables

- [ ] Create `x-pack/platform/plugins/shared/groups/public/embeddables/index.ts`:
  - Export all embeddable factories
- [ ] Update `public/plugin.ts`:
  - Register embeddables in `setup()` using `registerReactEmbeddableFactory`

### 🧪 Validation Point 7.1: Embeddables Work

```bash
yarn es snapshot --license trial
yarn start

# 1. Create a group via API or UI
# 2. Add some dashboard members to the group
# 3. Create a new dashboard
# 4. Click "Add panel" and find "Group Info" or "Group Dashboard List"
# 5. Configure the embeddable with the group ID
# 6. Verify it displays correctly
```

- [ ] Group Info embeddable appears in panel picker
- [ ] Group Info shows group name and description
- [ ] Dashboard List embeddable shows dashboard links

### 7.4 Run Verification Commands

```bash
node scripts/eslint --fix x-pack/platform/plugins/shared/groups/
node scripts/type_check --project x-pack/platform/plugins/shared/groups/tsconfig.json
```

- [ ] Linting passes with 0 errors
- [ ] Type checking passes with 0 errors
- [ ] Commit changes: "feat(groups): add dashboard embeddables"

---

## Phase 8: Unit Tests (📍 Context Reset Point)

**Goal**: Add comprehensive unit tests for all functionality.

### 8.1 Storage Layer Tests

- [ ] Create `x-pack/platform/plugins/shared/groups/server/lib/storage/__tests__/groups_storage_client.test.ts`:
  - Test CRUD operations
  - Test pagination
  - Test error handling
- [ ] Create `x-pack/platform/plugins/shared/groups/server/lib/storage/__tests__/members_storage_client.test.ts`:
  - Test add/remove operations
  - Test query operations

### 8.2 Route Handler Tests

- [ ] Create `x-pack/platform/plugins/shared/groups/server/routes/groups/__tests__/`:
  - `create.test.ts`
  - `get.test.ts`
  - `list.test.ts`
  - `update.test.ts`
  - `delete.test.ts`
- [ ] Create `x-pack/platform/plugins/shared/groups/server/routes/members/__tests__/`:
  - `add.test.ts`
  - `remove.test.ts`
  - `list.test.ts`

### 8.3 ACL Service Tests

- [ ] Create `x-pack/platform/plugins/shared/groups/server/lib/acl/__tests__/acl_service.test.ts`:
  - Test permission checks
  - Test owner access
  - Test role-based access

### 8.4 Public Components Tests

- [ ] Create `x-pack/platform/plugins/shared/groups/public/pages/__tests__/`:
  - `groups_list.test.tsx`
  - `group_detail.test.tsx`
- [ ] Create `x-pack/platform/plugins/shared/groups/public/embeddables/__tests__/`:
  - `group_info_embeddable.test.tsx`
  - `dashboard_list_embeddable.test.tsx`

### 🧪 Validation Point 8.1: All Tests Pass

```bash
# Run all unit tests
yarn test:jest x-pack/platform/plugins/shared/groups/

# Run with coverage
yarn test:jest x-pack/platform/plugins/shared/groups/ --coverage
```

- [ ] All tests pass
- [ ] Coverage is acceptable (aim for >80%)

### 8.5 Run Verification Commands

```bash
node scripts/eslint --fix x-pack/platform/plugins/shared/groups/
node scripts/type_check --project x-pack/platform/plugins/shared/groups/tsconfig.json
yarn test:jest x-pack/platform/plugins/shared/groups/
```

- [ ] Linting passes with 0 errors
- [ ] Type checking passes with 0 errors
- [ ] All tests pass
- [ ] Commit changes: "test(groups): add unit tests"

---

## Phase 9: Integration Tests (📍 Context Reset Point)

**Goal**: Add API integration tests.

### 9.1 Create Test Config

- [ ] Create `x-pack/platform/plugins/shared/groups/server/integration_tests/config.ts`:
  - Extend appropriate FTR config
  - Configure test users and roles

### 9.2 Create API Integration Tests

- [ ] Create `x-pack/platform/plugins/shared/groups/server/integration_tests/groups_api.test.ts`:
  - Test full CRUD lifecycle
  - Test membership operations
  - Test ACL enforcement
  - Test error scenarios

### 🧪 Validation Point 9.1: Integration Tests Pass

```bash
# Run integration tests
yarn test:ftr --config x-pack/platform/plugins/shared/groups/server/integration_tests/config.ts
```

- [ ] All integration tests pass

### 9.3 Run Verification Commands

```bash
node scripts/eslint --fix x-pack/platform/plugins/shared/groups/
node scripts/type_check --project x-pack/platform/plugins/shared/groups/tsconfig.json
```

- [ ] Linting passes with 0 errors
- [ ] Type checking passes with 0 errors
- [ ] Commit changes: "test(groups): add integration tests"

---

## Phase 10: Documentation & Polish (📍 Context Reset Point)

**Goal**: Add documentation and final polish.

### 10.1 Add README

- [ ] Create `x-pack/platform/plugins/shared/groups/README.md`:
  - Plugin overview
  - API documentation
  - Configuration options
  - Development guide

### 10.2 Add API Documentation

- [ ] Create `x-pack/platform/plugins/shared/groups/docs/API.md`:
  - Document all endpoints
  - Include request/response examples
  - Document error codes

### 10.3 Clean Up Code

- [ ] Review all files for TODO comments
- [ ] Ensure consistent code style
- [ ] Remove any debugging code
- [ ] Add JSDoc comments to public interfaces

### 10.4 Final Validation

```bash
# Full verification
node scripts/eslint --fix x-pack/platform/plugins/shared/groups/
node scripts/type_check --project x-pack/platform/plugins/shared/groups/tsconfig.json
yarn test:jest x-pack/platform/plugins/shared/groups/

# Manual testing
yarn es snapshot --license trial
yarn start
# Exercise all features in the UI
```

- [ ] All linting passes
- [ ] All type checking passes
- [ ] All tests pass
- [ ] Manual testing successful
- [ ] Commit changes: "docs(groups): add documentation"

---

## Summary: Context Reset Points

Use these points to start new conversations with the coding agent:

| Phase | Description | Starting Point |
|-------|-------------|----------------|
| 1 | Plugin Skeleton | Start fresh, no prior code |
| 2 | Storage Layer | Plugin boots, no storage |
| 3 | CRUD APIs | Storage exists, no routes |
| 4 | Membership APIs | Group CRUD works |
| 5 | ACL | Membership works, no auth |
| 6 | Public UI | Server complete, no UI |
| 7 | Embeddables | UI works, no embeddables |
| 8 | Unit Tests | All code complete, no tests |
| 9 | Integration Tests | Unit tests pass |
| 10 | Documentation | All tests pass |

---

## Quick Reference: Verification Commands

```bash
# After EVERY step
node scripts/eslint --fix x-pack/platform/plugins/shared/groups/
node scripts/type_check --project x-pack/platform/plugins/shared/groups/tsconfig.json

# After adding tests
yarn test:jest x-pack/platform/plugins/shared/groups/

# Manual testing
yarn es snapshot --license trial
yarn start
```

---

*This checklist accompanies IMPLEMENTATION_PLAN.md and DESIGN_RATIONALE.md*
