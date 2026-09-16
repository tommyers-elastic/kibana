# Entity inventory

Server-only Observability plugin that serves inventory **lists**, **details** and **counts** for
registered entity types with ES|QL generated from their entity definitions, straight from raw
telemetry. Nothing is materialised: every request reads the source data streams.

Definitions come from the entity store (`entityStore` plugin): authored types registered through
`/internal/entity_store/definitions` (`k8s.pod`, `k8s.node`, ...) and built-in Security types that
carry an inventory extension (`host`). The plugin is gated by the ui setting
`entityInventory:enabled` (API-only, default off) and authorised by the store's neutral
`read_entity_definitions` privilege.

## Routes (internal, unversioned; send `x-elastic-internal-origin: kibana`)

| route | purpose |
| --- | --- |
| `GET /internal/entity_inventory/types` | types with an inventory extension: label, identity, output columns, sources |
| `POST /internal/entity_inventory/entities/{type}/_list` | `{ from, to, limit?, sort?, filter? }` → rows, exact `total`, `truncated`, timings, generated queries |
| `POST /internal/entity_inventory/entities/{type}/_detail` | `{ from, to, identity: { field: value } }` → the same shape for one entity |
| `POST /internal/entity_inventory/entities/{type}/_count` | `{ from, to, filter? }` → exact distinct count |

`from`/`to` are absolute ISO instants (the generator never uses `NOW()`); `limit` is 1 to 10,000;
`sort` names any output column; `filter` is one query DSL clause applied as the ES|QL request
`filter` (never interpolated). Every response returns the generated ES|QL per query with its
parameters, ES `took`, `documents_found` and row count, plus end-to-end `tookMs`.

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

- **Identity** is grouped on raw mapped fields and the id is computed on the aggregated rows with
  the store's EUID compiler. Authored types group by their tuple; built-in types group by every
  field their ranking references (`host.id`, `host.name`, `host.hostname`) and the compiler picks
  the id per row, so ids match Security's. Computing the id per document is 200x slower.
- **Existence per source**: a source with metrics lists the entities that reported at least one
  of them in the window (explicit in `WHERE`, which is also what `TS` does implicitly); a source
  without metrics lists every identity occurrence. Type-level existence is the union.
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

## Merge semantics

Rows are merged in Kibana by `entity.id`. Per column, the value from the source with the newest
`last_seen` wins; a null never overrides a value; `last_seen` is the newest of all. Per-source
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
