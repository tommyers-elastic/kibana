# Entity inventory

Observability plugin that serves inventory **lists**, **details** and **counts** for
registered entity types with ES|QL generated from their entity definitions, straight from raw
telemetry. Nothing is materialised: every request reads the source data streams.

Definitions come from the entity store (`entityStore` plugin): authored types registered through
`/internal/entity_store/definitions` (`k8s.pod`, `k8s.node`, ...) and built-in Security types that
carry an inventory extension (`host`). The plugin is gated by the ui setting
`entityInventory:enabled` (API-only, default off) and authorised by the store's neutral
`read_entity_definitions` privilege.

## Management UI (development)

`/app/entityInventoryDefinitions` (hidden from navigation; requires the `entityInventory:enabled`
ui setting) lists the definitions of the current space from `GET /internal/entity_store/definitions`
with their `source` (`built_in` | `code` | `api`) and `inventorySource`, and edits them as JSON:
API definitions are sent back without their `id` to `PUT /internal/entity_store/definitions/{type}?force=true`,
API extensions of built-ins as `{ extends, inventory }` to the same route, "New" posts either
document kind, and "Delete" removes the definition or the built-in's extension. Built-ins without
an API extension and code-registered records are read-only. A preview section runs
`POST /internal/entity_inventory/entities/{type}/_list` over a 15m / 1h / 6h window for any type
returned by `GET /internal/entity_inventory/types` and shows the rows, timings and generated ES|QL.

## AI-assisted authoring

When the `agentBuilder` plugin is present (it is an optional dependency), the plugin wires a
dedicated authoring assistant into Agent Builder. Everything lives under `server/agent_builder/`.

- **Skill** `observability.entity-inventory-definitions` (`skills/observability/entity-inventory-definitions`):
  the authoring rules from `entity_inventory_definition_authoring_skill.md` at the repository root
  (`skills/definition_authoring/skill.md.text`, with a "Tools" section mapping each step to a tool;
  the frontmatter description is `description.text`). It exposes the tools below plus the platform
  data exploration tools (`platform.core.execute_esql`, `list_indices`, `get_index_mapping`,
  `index_explorer`).
- **Tools** (`tools/`, ids prefixed `observability.entity_inventory.`, all allow-listed in
  `@kbn/agent-builder-server/allow_lists`):

  | tool | purpose |
  | --- | --- |
  | `list_types` | inventory types of the space: label, source, editability, identity, sources, metric and attribute names (`includeWithoutInventory` adds bare built-ins) |
  | `get_definition` | the record of one type as the document `save_definition` accepts back (API definition without `id`, or `{ extends, inventory }`), or a not-found error |
  | `preview_inventory` | runs the list for `[now - minutes, now]` and returns total, rows, columns, per-query engine / took / documents / ES\|QL, errors, unavailable columns and provenance; a clear error when the inventory ui setting is off |
  | `save_definition` | validates with the store's `entityDefinitionsApiBodySchema` (issues come back as a result, nothing is written), then `create` or `replace` (with `force` for identity changes) through the store's request-scoped `EntityDefinitionsClient`; asks the user to confirm with a summary of type, sources and metrics |
  | `delete_definition` | deletes a definition or a built-in's API extension; destructive, always confirmed |

  Store errors are mapped to `{ kind, message, hint }` (`validation`, `not_found`, `conflict`,
  `disabled` for the `entityStore:dynamicDefinitionsEnabled` setting, `forbidden` for the
  `entityInventory:enabled` setting) so the agent knows what to do next.
- **Agent** `observability.entity-inventory-definitions` ("Entity definition author") of the type
  `observability.entity-inventory-definitions-type`. The type carries the configuration
  (instructions, the tools above, the skill, no Elastic capabilities), so changes ship with code;
  the persisted agent is an empty delta ensured in the `default` space at start
  (`agents.ensure`, create-if-absent, failures are logged and skipped).
- **Entry points** in `/app/entityInventoryDefinitions`: "Create with AI" on the definitions list
  and "Ask AI about this definition" on a definition's detail page, both opening an `EuiFlyout`
  with `agentBuilder.EmbeddableConversation` (agent above, session tag
  `entity-inventory-definitions`; the detail action starts a new conversation seeded with the
  current document). The list reloads when the flyout closes. Both are hidden when the
  `agentBuilder` browser plugin is absent.
- **Model management**: when `searchInferenceEndpoints` is present, the plugin registers the
  Stack Management > Model Management > Feature Settings cards "Entity inventory"
  (`observability_entity_inventory`) and "Definition authoring"
  (`observability_entity_inventory_definition_authoring`, `chat_completion`, Agent Builder's
  recommended endpoints; feature ids may not contain dots).

### Known gaps

- **The model selected under "Definition authoring" is not used yet.** Agent Builder resolves the
  model of a conversation from the connector the user picks in the UI, the Gen AI default connector
  settings, and its own `agent_builder` feature (`resolveSelectedConnectorId`); an agent's
  configuration has no model or connector binding (`connector_ids` scopes data source connectors
  for SML search, not the LLM), and agent types cannot contribute one. The feature exists so the
  card is there; binding it needs an Agent Builder change (per-agent connector resolution).
- The agent is ensured in the `default` space only.
- Prototype: the store's `getEntityDefinitionsClient(request)` checks the dynamic definitions
  setting and saved-object authorization but not the `manage_entity_definitions` Kibana privilege;
  Agent Builder's own authorization applies to the tool user.

## Routes (internal, unversioned; send `x-elastic-internal-origin: kibana`)

| route | purpose |
| --- | --- |
| `GET /internal/entity_inventory/types` | types with an inventory extension: label, identity, output columns, sources |
| `POST /internal/entity_inventory/entities/{type}/_list` | `{ from, to, limit?, sort?, documentFilter? }` → rows, exact `total`, `truncated`, timings, generated queries |
| `POST /internal/entity_inventory/entities/{type}/_detail` | `{ from, to, identity: { field: value } }` → the same shape for one entity |
| `POST /internal/entity_inventory/entities/{type}/_count` | `{ from, to, documentFilter? }` → exact distinct count |
| `POST /internal/entity_inventory/entities/{type}/_document_counts` | `{ from, to }` → documents in the window per source pattern, before any predicate (the denominator for a list query's `documentsFound`; kept out of the list's timings) |

`from`/`to` are absolute ISO instants (the generator never uses `NOW()`); `limit` is 1 to 10,000;
`sort` names any output column. `documentFilter` is one query DSL clause against source document
fields, passed as the ES|QL request `filter` (never interpolated). It applies to every source before
aggregation and to the count query, alongside the time window and definition-level source predicates.
Only matching documents contribute to entity membership, attributes, metrics and counts. For example,
filtering on `stream: stderr` counts and aggregates matching stderr documents; sources whose documents
do not match contribute nothing, even if they describe the same entity. Output metric names and
attribute display labels are not source document fields.

The definition's per-source `filter` remains an ES|QL expression selecting documents for that source.
The preview UI's "Filter the returned rows" search runs locally over the merged rows already fetched
(up to 10,000), without changing their aggregates or the API total. There is no API `entityFilter`.

The preview's optional "Document filter (KQL)" input sends `documentFilter` when Run is clicked.
List responses include advisory `documentFilterWarnings` identifying sources, unmapped fields,
excluded concrete indices and potentially affected columns. A warning distinguishes exclusion of
every identity-capable index in a source from exclusion of only some of those indices. It does not
skip the source or rewrite the filter. Count query generation is unchanged.
Equivalent warnings are grouped by identity-capable backing indices and per-index exclusion reasons;
`sourcePatterns` and affected columns retain the union of the contributing sources. Partially
overlapping coverage remains separate.

Metadata resolution shares settings lookups by source pattern and requests field capabilities once
for the union of resolved backing indices and required fields. Each source receives its own subset
for validation and engine selection. Settings and field capabilities have separate short-lived
caches. If the batched field-capabilities request fails, it retries by pattern to isolate failures.

Source validation requires every field of at least one identity composition to be mapped together
in at least one concrete index. Filter warnings consider only indices satisfying that condition.
The mapping analysis supports positive `term`, `terms`, `range`, `exists`, `prefix`, `wildcard`,
`regexp`, `match` and `match_phrase` clauses, combined with `bool.must`, `filter` and `should`
(default or nonnegative integer `minimum_should_match`). Negations, opaque clauses, wildcard field
names and complex `minimum_should_match` expressions are not used to prove exclusions. Analysis is
bounded to 256 nodes and 16 nesting levels. No warning does not guarantee complete coverage: mappings
do not establish that fields are populated on every document, and unsupported clauses remain opaque.

Every response returns the generated ES|QL per query with its parameters, ES `took`, `documents_found`
and row count, plus end-to-end `tookMs`.

## Query shapes

One query per source, under the engine resolved for that source (`TS` when every backing index is
`time_series`, otherwise `FROM`):

```
SET unmapped_fields="nullify";
TS metrics-kubernetes.pod-*
| WHERE @timestamp >= ?from AND @timestamp < ?to
    AND `kubernetes.pod.uid` IS NOT NULL
    AND (`kubernetes.pod.cpu.usage.node.pct` IS NOT NULL OR `kubernetes.pod.memory.usage.bytes` IS NOT NULL)
| STATS `cpu_node_pct` = AVG(AVG_OVER_TIME(`kubernetes.pod.cpu.usage.node.pct`)),
    `mem_usage_bytes` = AVG(AVG_OVER_TIME(`kubernetes.pod.memory.usage.bytes`)),
    `kubernetes.pod.name` = LAST(`kubernetes.pod.name`, @timestamp) WHERE `kubernetes.pod.name` IS NOT NULL,
    ...
    `last_seen` = MAX(@timestamp)
    BY `kubernetes.pod.uid`
| EVAL entity.id = CONCAT("k8s.pod:", TO_STRING(kubernetes.pod.uid))
| KEEP `entity.id`, `kubernetes.pod.uid`, ..., `last_seen`
| SORT `last_seen` DESC NULLS LAST
| LIMIT 10000
```

- **Identity** is read from the definition's `identityField`, the single identity declaration of
  every type (`getInventoryIdentityPlan` in the store: one field list per ranking composition).
  Rows are grouped on the raw mapped fields and the id is computed on the aggregated rows with the
  store's EUID compiler. One composition is a tuple: every field required, `k8s.deployment` by
  `kubernetes.namespace + kubernetes.deployment.name`. Several compositions are a ranking (built-in
  types such as `host`, and authored alternatives such as a claim id carried as `halcyon.claim_id`
  in traces and `claim_id` in logs): rows group by every alternative and the compiler picks the
  first present one per row, so the same value under different field names yields one entity that
  the merge unions across sources. The store validates authored inventory definitions to the subset
  served here (literal fields, one unconditional branch, no field evaluations, the derived presence
  `documentsFilter`). Computing the id per document is 200x slower.
- **Existence per source**: a source with metrics lists the entities that reported at least one
  of them in the window (explicit in `WHERE`, which is also what `TS` does implicitly); a source
  without metrics lists every identity occurrence. Type-level existence is the union. Only value
  metrics (`avg`, `min`, `max`, `sum`, `last`) define "reported": a `count_distinct` over a
  dimension present on every document would make the predicate vacuous and the `FROM` count a
  full scan.
- **Metrics**: `avg`/`min`/`max`/`sum` are window aggregates (`AGG(AGG_OVER_TIME(f))` under `TS`,
  `AGG(f)` under `FROM`, identical results); `count_distinct`; `last` is the newest sample.
- **Attributes** are always `LAST(f, @timestamp) WHERE f IS NOT NULL`: never split an entity,
  cost about 3 ms per million scanned documents per attribute.
- **Count** is one `FROM` query over every source with `METADATA _index` so each source's
  predicates apply to its own indices, then `STATS BY identity | STATS COUNT(*)`: exact at any
  scale, 15% to 30% of the list cost. `truncated` is `total > rows returned`.
- Single-source lists push the caller's sort and limit into ES|QL; multi-source lists sort by
  `last_seen` at the 10,000 row cap per source (the newest entities survive a capped source) and
  sort in Kibana after the merge.

The measurements behind these rules are in `entity_inventory_query_performance.md` at the
repository root.

## Entities without metrics

Existence is decided **per source**, and a type's inventory is the union of what its sources see.

- A source that declares value metrics (`avg`, `min`, `max`, `sum`, `last`) lists the entities that
  reported at least one of them in the window. Under `TS` this is how the engine works (it only
  reads documents carrying a `*_OVER_TIME` field); under `FROM` the generator writes the same rule
  into `WHERE`, so both engines and the count agree. `count_distinct`, attributes and `last_seen`
  never widen a source's view.
- A source without value metrics lists every entity with any document in the window.

Example, the pod definition: a pod that is pending or has finished has no cpu or memory documents,
so the kubeletstats source never lists it. The k8sclusterreceiver source (phase gauge, no value
metrics) and the ECS `state_pod` source (phase keyword, no metrics) list every pod with a state
document, so the pod appears in the merged inventory with identity, name, namespace, node,
`phase: succeeded` and null metrics, and the exact count includes it.

Authoring consequence: a type whose sources all declare value metrics shows only entities that
reported them in the window. To surface silent entities, declare the family that knows about them
as its own metric-less source (this is why the ECS pod definition has `metrics-kubernetes.pod-*`
with metrics and `metrics-kubernetes.state_pod-*` without). The alternative, an extra presence
scan per metrics source, more than doubles the cost and was rejected; the measurements are in
`entity_inventory_query_performance.md` §3.

## Merge semantics

Rows are merged in Kibana by `entity.id`. Metrics take the value of the **first source in
definition order** that has one (both sources describe the same window, so "scraped last" would be
arbitrary; authors put the pipeline they trust first). Attributes take the value from the source
with the newest `last_seen` (mutable state such as phase). A null never overrides a value, so a
preferred source without a value falls through to the next. `last_seen` is the newest of all. The
response's `provenance` map records which source supplied every merged metric and attribute per
row. Metrics that share a name across sources are the same measurement in the same unit: the schema
requires matching `agg` and `unit`, and a metric's `scale` (applied on the aggregated rows) is how a
pipeline's field is normalised into that unit (ECS nanocores `scale: 1e-9` next to OTel cores). Per-source
attributes are merged by `name` and their `valueLabels` applied before the merge (unlabelled raw
values pass through as strings). A failed source is reported in `errors[]` and does not fail the
request; a source whose pattern matches no index, or whose identity fields are all unmapped, is
excluded and reported; attributes or metrics whose field is unmapped in a source are still queried
(they nullify) and reported in `unavailableColumns`.

## Known quirks

- A source with more than 10,000 entities in the window returns 10,000 (`capped: true` on its
  query); the exact `total` says how many the response lacks. Short windows keep live sets small.
- Ranked (built-in) identities split an entity when its documents differ in which ranking fields
  they carry, exactly as Security's per-document ranking does; the fix is upstream (emit the
  top-ranked field on every pipeline).
- Same-source duplicates of a ranked identity (groups that resolve to the same id) merge with the
  same newest-wins rule, so a window aggregate is that of the newest group, not of both.
