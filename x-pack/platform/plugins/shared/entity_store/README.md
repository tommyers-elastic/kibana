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
| Inventory extension | `inventory_schema.ts` | Inventory query generation (later stage) |

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

### Compiling a definition object

Every EUID compiler entry point has a `*FromDefinition` variant that takes a definition object instead
of a registered type name (e.g. `getEuidEsqlEvaluationFromDefinition`, `getEuidFromDefinition`,
`getEuidDslFilterBasedOnDocumentFromDefinition`, `getEuidSourceFieldsFromDefinition`). The type-name
variants delegate to them via the built-in registry.

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
