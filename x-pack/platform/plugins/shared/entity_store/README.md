# Entity Store

Central place for Entities management and logs extraction.

## Entity definitions: identity core and extensions

An entity definition (`common/domain/definitions/entity_schema.ts`) is a **shared identity core**
plus optional, independently validated **solution extensions**. The core is what the EUID compiler
(`common/domain/euid/*`) consumes; each extension is read only by the code path that owns it.

```ts
{
  type: 'k8s.deployment',                 // string; the built-in registry narrows it to the EntityType enum
  name: '...',
  identityField: { ... },                 // singleField | { euidRanking, documentsFilter, fieldEvaluations? }
  materialisation?: { mode: 'extraction', fields, ... } | { mode: 'none' },
  inventory?: { identity, sources, ... },
}
```

| Part | File | Read by |
| --- | --- | --- |
| Identity core (`type`, `name`, `identityField`) | `identity_core_schema.ts` | EUID compiler (all five backends), extraction, CRUD |
| Materialisation extension | `materialisation_schema.ts` | Logs extraction, component templates, CRUD field validation, single-document creation |
| Inventory extension (`identity`, `attributes`, `sources[].{index, filter, metrics, attributes}`, `label`) | `inventory_schema.ts` | Inventory query generation (later stage) |

### Materialisation modes

- `mode: 'extraction'` — the behaviour of the four built-in Security types (`host`, `user`,
  `service`, `generic`). The extension carries `fields` (with retention), `fieldEvaluations`,
  `postAggFilter`, `whenConditionTrueSetFieldsPreAgg` / `whenConditionTrueSetFieldsAfterStats`,
  `entityTypeFallback` and `creatableFromSingleDocument`. The type gets a component template, an
  entry in the latest/history index templates, an extraction task and install/start/stop steps, and
  accepts CRUD writes.
- `mode: 'none'` (or no `materialisation` at all) — the definition is never extracted into the
  store. Nothing is installed or scheduled for it and the CRUD API rejects writes with a 400. The EUID
  compiler still works fully for it (ids, filters, Painless, in-memory), given the definition object.

`getMaterialisedEntityTypes()` in `registry.ts` is the list every install/template/task code path
iterates; accessors such as `getMaterialisation()`, `getEntityFields()` and `getPostAggFilter()` in
`entity_schema.ts` read the extension safely for either mode.

### Identity tuple authoring form (inventory definitions)

Observability definitions author identity as an ordered list of **literal, mapped field paths**:

```ts
inventory: { identity: ['kubernetes.namespace', 'kubernetes.deployment.name'], ... }
```

`identityTupleToIdentityField()` (`identity_tuple.ts`) normalises this into the store's identity
form so the compiler needs no changes: one field becomes `{ singleField }`; several fields become one
ranking composition joined by `/` plus a `documentsFilter` requiring every field. The resulting id is
`<type>:<v1>/<v2>` (e.g. `k8s.deployment:payments/checkout-api`); values are not escaped, so a value
containing `/` is ambiguous, exactly as `@` already is for `user`. Expressions, wildcards, quoting and
whitespace are rejected: identity must push down to the index. The raw list is kept on
`inventory.identity` because the query generator groups `BY` these fields, and `entitySchema` checks
that `identityField` and `inventory.identity` agree. `buildInventoryEntityDefinition()` assembles a
complete non-materialised definition from the authoring form.

Authors declare what they need, not how it is fetched: `attributes` is a list of literal field paths
resolved to the newest value per entity, and each source's `metrics` are `{ name, field, agg }` with
`agg` one of `avg | min | max | sum | count_distinct | last` (`avg`/`min`/`max`/`sum` are window
aggregates with identical results under both engines; `last` is the newest sample), plus optional
`scale` (a multiplier applied after aggregation, e.g. `1e-9` from nanocores to cores) and `unit`.
Across sources the same metric `name` is the same measurement in the same unit: shared names must
share `agg` and `unit`, and `scale` is how a pipeline's field is brought into that unit. Fields that do
not alias across pipelines are declared per source as `attributes: [{ name, field, valueLabels? }]`
and merged by `name` across sources like metrics; `valueLabels` maps raw values (stringified) to
canonical labels on the aggregated rows, and an unmapped raw value passes through. Names are output
columns and must be unambiguous across the extension. A source with metrics lists the entities that
reported at least one of them in the window; a metric-less source lists every identity occurrence,
so a family that defines existence on its own is declared as its own source. Engine selection,
`BY` versus `LAST(...)` placement, null handling and `*_OVER_TIME` wrapping belong to the query
generator (see `entity_inventory_query_performance.md` at the repository root for the measurements
behind those rules). The only ES|QL an author writes is the optional per-source `filter` (the
document-family discriminator). Time windows and sort order are client concerns. Metadata lookup/write indices, relationships (edges) and derived
metadata are deferred; the entity inventory context document tracks what is deferred and why.

### Compiling a definition object

Every EUID compiler entry point has a `*FromDefinition` variant that takes a definition object instead
of a registered type name (e.g. `getEuidEsqlEvaluationFromDefinition`, `getEuidFromDefinition`,
`getEuidDslFilterBasedOnDocumentFromDefinition`, `getEuidSourceFieldsFromDefinition`). The type-name
variants delegate to them via the built-in registry.

### Dynamic entity types (registration)

`EntityType` is any type name (`string`, validated by `entityTypeNameSchema`); the four Security
types are the closed `BuiltInEntityType` enum (`ALL_BUILT_IN_ENTITY_TYPES`, `isBuiltInEntityType`).
Built-ins are reserved: they are the only types with engines and cannot be created, replaced or
deleted through the API. The deprecated `EntityType` value and `ALL_ENTITY_TYPES` remain aliases of
the built-in set so existing validation keeps rejecting unknown names.

Definitions are resolved per space by the server-side `EntityDefinitionRegistry`
(`server/domain/definitions`), layered from three sources:

| Source | How it is registered | Scope | Materialisation |
| --- | --- | --- | --- |
| `built_in` | code (`common/domain/definitions/registry.ts`) | global | `extraction` |
| `code` | `entityStore.registerEntityDefinition(definition)` on the **setup** contract | global, in memory | `none` only |
| `api` | `POST /internal/entity_store/definitions` | per space (saved object `entity-store-definition`) | `none` only |

Other plugins read definitions through the **start** contract:

```ts
const registry = plugins.entityStore.getEntityDefinitionRegistry(spaceId);
const record = await registry.getDefinition('k8s.deployment'); // EntityDefinitionRecord | undefined
const live = await registry.getDefinitions({ mode: 'none' });
euid.fromDefinition.getEuid(record.definition, doc); // 'k8s.deployment:payments/checkout-api'
```

`EntityDefinitionRecord` carries `definition` (with a per-space `id`: `security_<type>_<space>` for
built-ins, `registered_<type>_<space>` otherwise), `source`, and for API definitions `createdAt` and
`updatedAt`. The store does not version definitions; an author may declare an optional integer
`version` in the definition itself and bump it when the identity changes, because a replace that
changes the identity (rejected with 409 unless `?force=true`) makes previously derived ids
incomparable. API definitions are cached per space in each Kibana node for 30s and
invalidated immediately by writes on that node. The saved objects are visible, importable and
exportable in Saved Objects management (the generic saved objects HTTP API stays closed). Import
bypasses the definitions API, so the registration rules are re-applied when a space's definitions are
loaded: an imported object that names a reserved type, is materialised or fails the schema is imported
with a warning and then ignored (logged) rather than served.

The HTTP API (`/internal/entity_store/definitions`, `elastic-api-version: 2`) offers `GET` (list,
`?mode=none|extraction`), `POST` (create, 201), `GET /{type}`, `PUT /{type}[?force=true]` and
`DELETE /{type}`. The body is the definition without `id` (`entityDefinitionInputSchema`; unknown keys
are rejected). It is gated on the `entityStore:dynamicDefinitionsEnabled` ui setting (API-only, off
by default) and on the neutral **Entity definitions** Kibana feature (`read_entity_definitions` /
`manage_entity_definitions`), not on the Security Solution privilege or on the store being installed
in the space. Registering a type never creates an engine, component template, extraction task or
install step; those remain driven by `getMaterialisedEntityTypes()` over the built-ins.

#### Inventory extensions for built-in types

Built-in types cannot be registered again, but an inventory view can be attached to one (e.g. an
Observability `host` inventory that keeps Security's `host:` entity ids) with an **extension
document**: `{ "extends": <built-in type>, "inventory": <BuiltInInventoryExtension> }`
(`builtInInventoryExtensionDocumentSchema`, strict). A document with `type` is a full definition
(identity required); a document with `extends` is an extension and carries no `type`, identity or
materialisation. The inventory part is `builtInInventoryExtensionSchema`: the inventory extension
without `identity`. The built-in's identity and materialisation are never changed; its
`identityField` is the identity, so the query generator groups by the fields that ranking
references and entity ids stay the built-in's. Attributes may not be identity fields of the
built-in (rejected at registration, as `attributes` repeating `identity` is for authored
definitions); `getInventoryIdentity(definition)` returns the authored tuple or `undefined` for a
built-in.

Extensions are registered in two ways, layered code-first:

| Source | How | Scope |
| --- | --- | --- |
| `code` | `entityStore.registerInventoryExtension({ extends: 'host', inventory })` on the **setup** contract | global, in memory, one per type (a second registration throws) |
| `api` | the definitions API with an extension body (below) | per space (saved object `entity-store-inventory-extension`) |

A code extension wins over an API extension of the same type, and the API can neither create,
replace nor delete an extension for a type that has one in code (409). `EntityDefinitionRegistry`
serves the built-in record with `definition.inventory` set and `inventorySource: 'code' | 'api'`
(`createdAt` / `updatedAt` are the extension's for `api`); `definition.source` stays `built_in`.
`getDefinitions({ inventory: true })` returns only the records that carry an inventory extension
(built-ins with one and code or API definitions that declare one). The static
`common/domain/definitions/registry.ts` and everything that extracts or materialises built-ins are
unaffected.

The **definitions API accepts both document kinds**, discriminated on `type` vs `extends` (a body
with neither or both is a 400):

```ts
plugins.entityStore.registerInventoryExtension({
  extends: 'host',
  inventory: {
    label: 'Hosts',
    attributes: ['host.os.name', 'cloud.provider'],
    sources: [{ index: 'metrics-system.cpu-*', metrics: [{ name: 'cpu_pct', field: 'system.cpu.total.norm.pct', agg: 'avg' }] }],
  },
});
```

- `POST /internal/entity_store/definitions` with `{ extends, inventory }`: creates the extension
  for the built-in in the current space (201, the layered built-in record). 409 if the space
  already has one (use `PUT`) or one is registered in code; 400 if `extends` is not a built-in
  (register a full definition with `type` instead), on a schema failure or on an identity-field
  attribute.
- `PUT /internal/entity_store/definitions/{type}` with `{ extends, inventory }`: creates or
  replaces the extension (idempotent, `createdAt` kept); 400 if `{type}` differs from `extends`.
  `force` is irrelevant for extensions (they never carry identity).
- `GET /internal/entity_store/definitions/{type}`: unchanged; a built-in with an extension returns
  the layered record. `GET /internal/entity_store/definitions?inventory=true` lists only records
  with an inventory extension (combinable with `mode`).
- `DELETE /internal/entity_store/definitions/{type}` on a built-in type: deletes the space's API
  extension (409 if it is code-registered); a bare built-in keeps today's 400 "built-in ... cannot
  be deleted".

Stored extensions are cached per space like definitions (30s, invalidated by writes on the node),
located by the extended `type` attribute (never by a derived id), visible, importable and
exportable in Saved Objects management, and re-validated on read: an imported object whose
`extends` is not a built-in, whose attributes clash with the identity, whose `type` disagrees with
`extends` or whose type has a code extension is imported with a warning and then ignored (logged).

## Entity AI Summary — index privileges

The Entity AI Summary is persisted to the entity **metadata** datastream
(`.entities.v2.metadata.{namespace}`), not to the entity latest index.
Its access-control model separates generation from display:

- **Generation** is gated only on feature-level permissions — the Security Solution
  Kibana feature plus its `entity-analytics` sub-privilege — and an **Enterprise**
  license. The persisted document is written with the Kibana **internal** user
  (`asInternalUser`), so a user does **not** need their own write privilege on the
  metadata index to generate and persist a summary.
- **Display** is gated on the user's **own** read privilege on
  `.entities.v2.metadata.*`. With read access the persisted summary is shown
  (including the original `generated_by` / `generated_at`, so a second user sees the
  first user's generation); without it the flyout gracefully falls back to on-demand
  generation and nothing is persisted for that view.

### Serverless

Serverless project roles already grant the required access (see
`src/platform/packages/shared/kbn-es/src/serverless_resources/project_roles/security/roles.yml`):
`viewer` / `t1_analyst` get `read` on `.entities.v2.metadata.*`, while
`editor` / `t2_analyst` / `detections_admin` get `read` + `write`.

### Self-managed / ECH (stateful)

To **see** a persisted AI summary on self-managed or Elastic Cloud Hosted deployments,
a user needs, in addition to the Security Solution Kibana feature privileges:

- `read` on the entity metadata indices `.entities.v2.metadata.*`.

No metadata **write** privilege is required for any user, because persistence always
goes through the Kibana internal user. Users lacking metadata read still get on-demand
generation (graceful degradation).

> Note: Elasticsearch built-in roles (e.g. `detections_admin`) are defined in the
> Elasticsearch repository, not in this fork. Whether they already include
> `.entities.v2.metadata.*` read is a verification item against a live cluster,
> not something enforced here. Kibana test fixtures cover the model via custom roles
> (see `security_solution/test/scout/entity_analytics/api/tests/ai_summary`).

## Entity Maintainers Framework

The Entity Store plugin exposes an **Entity Maintainers Framework** so that other plugins can register recurring tasks that run in the context of the entity store. Registration is part of the plugin setup contract: consumers call `registerEntityMaintainer` during their plugin’s `setup` phase and supply a configuration object.

### Setup contract and registration config

From the setup contract:

```ts
interface EntityStoreSetupContract {
  registerEntityMaintainer: RegisterEntityMaintainer;
}
```

`RegisterEntityMaintainer` accepts a `RegisterEntityMaintainerConfig`:

```ts
interface RegisterEntityMaintainerConfig {
  id: string;
  description?: string;
  interval: string;
  initialState: EntityMaintainerState;
  run: EntityMaintainerTaskMethod;
  setup?: EntityMaintainerTaskMethod;
}
```

- **id** - Unique identifier for the maintainer (used for task type and scheduling).
- **interval** - Cron-like interval at which the task runs (e.g. `5m`, `1h`).
- **initialState** - Initial state object for the maintainer, used on the first run before any `setup` or `run` has executed.
- **run** - Required. Called on every run (including the first). Must return the current state it manages.
- **setup** - Optional. If provided, it runs once before the first `run`. Useful for one-time initialization. 

### Scheduling and namespaces

The framework schedules all registered maintainers when the Entity Store is installed for a given space. 
The framework is **namespace aware**: each Kibana space gets its own task instance per maintainer (e.g. one task per `id` per namespace). Registration is global, scheduling is per namespace at install time.

### Run and setup behavior

- **run** is invoked on every execution at the configured interval. It receives a context (see below) and must return the **current state** it manages. That state is persisted and passed back in the context on the next run.
- **setup** is optional. When supplied, it runs a single time before the first **run**. It receives the same context shape and also returns state, that state becomes the initial state for the first **run**. If setup performs heavy work, the first iteration can be noticeably longer than subsequent ones.

Both methods must return the state object they manage so the framework can store it and expose it in the context for the next iteration.

### Callback context

Both `run` and `setup` receive a single context argument with:

- **status** - Object containing:
  - **metadata** - Maintained by the framework: `namespace`, `runs` (execution count), `lastSuccessTimestamp`, `lastErrorTimestamp`.
  - **state** - The state returned by the previous `run` (or by `setup` on the first run, or `initialState` before any execution).
- **abortController** - For cooperative cancellation if needed.
- **logger** - Scoped logger for the task.
- **fakeRequest** - Request-scoped utilities for the task execution environment.
- **esClient** - An Elasticsearch client scoped to the current context, using the permissions of the user who triggered the Entity Store plugin installation process.

Consumers implement their maintenance logic in `run` (and optionally in `setup`) using this context and return the updated state so the framework can keep it for the next run.
