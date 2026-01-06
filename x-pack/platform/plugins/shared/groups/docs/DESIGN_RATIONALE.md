# Groups vs Streams: Design Rationale

> **Why Groups is a separate abstraction from Streams**

This document explains the architectural decision to create a dedicated "Groups" plugin for content association rather than extending the existing Streams plugin.

---

## Executive Summary

**Streams** and **Groups** serve fundamentally different purposes:

- **Streams** = Data Management (how data flows and is processed)
- **Groups** = Content Organization (how assets are associated for users)

While both can "associate" assets, they represent different layers of abstraction with different semantics, use cases, and user mental models. Conflating them would create semantic overload and limit the flexibility of both.

### Motivating Use Cases

Two primary use cases drive the need for Groups as a distinct concept:

1. **Service Health Monitoring** - Understanding the health of a service requires correlating data from multiple backends (logs, metrics, traces, databases, queues). Users need a single place to access all dashboards, alerts, SLOs, and cross-backend queries that together paint the full picture of service health.

2. **Technology/Integration Monitoring** - Elastic integrations (Kubernetes, MySQL, nginx, etc.) ship with many assets—dashboards, rules, SLOs, documentation—but today these are scattered across the UI with no centralized place to explore them in the context of the technology being monitored.

Neither use case fits naturally into the Streams abstraction.

---

## 1. What Streams Are

### Primary Purpose: Data Lifecycle Management

Streams are fundamentally about **data flow and processing**:

```
Data Source → Ingest → Processing → Routing → Storage
                ↓
         Stream Definition
         (schema, rules, transformations)
```

A stream represents:
- A data pipeline with defined structure
- Ingest and processing rules
- Schema definitions and field mappings
- Routing logic for where data goes
- Lifecycle policies for retention

### Streams and Asset Attachments

Streams support "attachments" - linking assets like dashboards, rules, and SLOs to a stream. But the semantic meaning is specific:

> "This dashboard visualizes data from this stream"
> "This rule monitors this stream's data for anomalies"
> "This SLO measures quality of this stream's data"

The relationship is **data-centric**: the asset exists to support the stream's data.

### Key Characteristics

| Characteristic | Streams |
|----------------|---------|
| Core abstraction | Data pipeline |
| Semantic meaning | "Data processing definition" |
| Asset relationship | "Supports this data source" |
| Schema | Yes - defines data structure |
| Processing rules | Yes - transformations, routing |
| User mental model | "I'm managing my data" |

---

## 2. What Groups Are

### Primary Purpose: Content Organization

Groups are about **associating assets for human purposes**:

```
User Intent → Group Definition → Asset Membership
                   ↓
            "These things belong together"
            (no data semantics implied)
```

A group represents:
- An arbitrary collection of assets
- Organized by user-defined criteria (service, technology, team, project)
- No inherent data processing semantics
- Pure organizational structure with optional saved queries

### Use Case: Service Health Monitoring

Consider monitoring the health of a "Payment Service". This service depends on:
- Application logs (from a logs stream)
- APM traces (from a traces stream)
- PostgreSQL metrics (from a database metrics stream)
- Redis cache metrics (from another metrics stream)
- Kafka queue metrics (from yet another stream)

To understand service health, an SRE needs:

```
Group: "Payment Service Health"
├── Dashboard: Payment Service Overview
├── Dashboard: PostgreSQL Performance
├── Dashboard: Redis Cache Hit Rates  
├── Dashboard: Kafka Consumer Lag
├── Dashboard: APM Service Map
├── Saved Query: Cross-backend latency correlation
├── Saved Query: Error rate by component
├── Rule: Payment Service Degradation Alert
├── Rule: Database Connection Pool Exhaustion
├── SLO: Payment Service Availability (99.9%)
├── SLO: Payment Latency P99 < 500ms
└── Runbook: Payment Service Incident Response
```

**This cannot be modeled as a stream** because:
- There's no single data source—it spans 5+ streams
- The group includes cross-backend queries that correlate data across streams
- The organizational unit is the *service*, not the data pipeline

### Use Case: Technology/Integration Monitoring

Elastic integrations bundle assets for monitoring specific technologies, but these assets have no centralized home:

```
Group: "Kubernetes Monitoring"
├── Dashboard: Cluster Overview
├── Dashboard: Node Metrics
├── Dashboard: Pod Performance
├── Dashboard: Deployment Status
├── Dashboard: Container Resource Usage
├── Rule: Node Not Ready
├── Rule: Pod CrashLoopBackOff
├── Rule: High Memory Pressure
├── SLO: Cluster Availability
├── Data View: kubernetes-*
├── Documentation: K8s Troubleshooting Guide
└── Saved Search: Recent Pod Failures
```

```
Group: "MySQL Monitoring"  
├── Dashboard: MySQL Overview
├── Dashboard: Query Performance
├── Dashboard: Replication Status
├── Dashboard: InnoDB Metrics
├── Rule: Replication Lag Alert
├── Rule: Connection Limit Warning
├── Rule: Slow Query Detection
├── SLO: Query Latency P95
├── Data View: mysql-*
└── Documentation: MySQL Best Practices
```

Today, users must navigate to separate apps to find dashboards, rules, SLOs, and data views for a given integration. Groups provide **a single landing page for all assets related to a technology**.

### Groups and Asset Membership

The semantic meaning of group membership is open-ended:

> "Everything I need to monitor the Payment Service"
> "All assets from the Kubernetes integration"
> "Cross-backend queries for debugging latency issues"
> "Onboarding materials for new SREs"

The relationship is **purpose-centric**: assets belong together because they serve a common monitoring or organizational goal.

### Key Characteristics

| Characteristic | Groups |
|----------------|--------|
| Core abstraction | Content collection |
| Semantic meaning | "Things that belong together" |
| Asset relationship | "User-defined association" |
| Schema | No - just metadata |
| Processing rules | No - purely organizational |
| User mental model | "I'm organizing my content" |

---

## 3. Why Not Extend Streams?

### 3.1 Semantic Overload

Using streams for general content organization would conflate two different concerns:

```
❌ Problematic: "Create a stream for the Payment Service"
   - What data does this stream process? None—it spans 5 different streams.
   - What's the schema? There isn't one—each backend has its own.
   - It's not a stream—it's being misused as an organizational container.

❌ Problematic: "Create a stream for Kubernetes assets"
   - This is an integration, not a data pipeline.
   - The "stream" would just be a folder with no data semantics.
```

This creates confusion about what a "stream" actually means.

### 3.2 Cross-Data Use Cases

Service health monitoring inherently spans multiple data sources:

```
Example: "Payment Service Health" group
├── Dashboard: Service Overview (from: APM traces stream)
├── Dashboard: PostgreSQL Metrics (from: database metrics stream)
├── Dashboard: Redis Performance (from: cache metrics stream)  
├── Dashboard: Kafka Consumer Lag (from: queue metrics stream)
├── Saved Query: Cross-backend latency correlation (spans ALL streams)
├── Rule: Service degradation alert (correlates multiple sources)
└── SLO: Overall availability (aggregates across streams)
```

A stream-based approach would require:
- Creating an artificial "meta-stream" with no actual data
- Or attaching assets to multiple streams and querying across them
- Neither reflects the actual user intent: "monitor this service"

Similarly, technology monitoring (like Kubernetes) involves:
- Multiple data types (metrics, logs, events)
- Multiple streams per cluster
- Assets that span all of them

### 3.3 Saved Queries and Cross-Backend Correlation

A key capability for service health monitoring is **saving queries that correlate data across backends**:

```esql
// Cross-backend latency analysis saved in Payment Service group
FROM traces-*, metrics-postgres-*, metrics-redis-*
| WHERE service.name == "payment-service"
| STATS 
    avg_trace_latency = AVG(trace.duration),
    avg_db_query_time = AVG(postgres.query.duration),
    cache_hit_rate = AVG(redis.cache.hit_rate)
  BY time_bucket = BUCKET(@timestamp, 1m)
| WHERE avg_trace_latency > 500 OR cache_hit_rate < 0.8
```

This query doesn't belong to any single stream—it correlates data from three different data sources to understand service behavior. Groups provide a natural home for such queries.

### 3.4 Independent Lifecycles

Streams and content organization have different lifecycles:

| Event | Stream Impact | Group Impact |
|-------|---------------|--------------|
| Database migrated to new host | Stream reconfigured | Group unchanged |
| New backend added to service | New stream created | Asset added to group |
| Integration updated | Stream schemas updated | New assets added to group |
| Team reorganization | Streams unchanged | Groups restructured |

### 3.5 Different Permission Models

- **Streams**: Permissions typically follow data access patterns
- **Groups**: Permissions follow service/team ownership

A developer might have access to the "Payment Service Health" group but only read access to the underlying database metrics stream. The permission models are orthogonal.

---

## 4. The Interplay: Using Both Together

Streams and Groups are complementary. Understanding how they work together is key to effective observability architectures.

### 4.1 Streams as Group Members

Since streams are first-class Kibana resources, they can be **members of groups**. This is essential for service health monitoring:

```
Group: "Payment Service Health"
├── Stream: payment-logs            ← The service's log pipeline
├── Stream: payment-traces          ← The service's trace pipeline
├── Stream: payment-metrics         ← The service's metrics pipeline
├── Dashboard: Payment Service Overview
├── Saved Query: Cross-backend latency analysis
├── Rule: Payment Service Degradation
└── SLO: Payment Service Availability (99.9%)
```

This provides a complete view:
- The **streams** show where data comes from
- The **dashboards** and **queries** show how data is analyzed
- The **rules** and **SLOs** show how health is monitored
- The **group** ties it all together as "Payment Service Health"

### 4.2 Stream Attachments vs Group Membership

Assets can have both relationships simultaneously:

```
Dashboard: "PostgreSQL Query Performance"

Stream Attachment (data relationship):
  └── Attached to: postgres-metrics-stream
      (because it visualizes PostgreSQL metrics)

Group Memberships (organizational relationships):
  ├── Member of: "Payment Service Health"     ← Used for payment service monitoring
  ├── Member of: "Inventory Service Health"   ← Used for inventory service monitoring
  ├── Member of: "MySQL Monitoring"           ← Wait—that's wrong! It's PostgreSQL.
  ├── Member of: "Database Operations"        ← DBA team's assets
  └── Member of: "On-Call Runbooks"           ← Referenced in incident response
```

The two relationships answer different questions:
- **Stream attachment**: "What data does this dashboard visualize?"
- **Group membership**: "What purposes does this dashboard serve?"

One dashboard → one data source (stream attachment)
One dashboard → many purposes (group memberships)

### 4.3 Technology Integration Landing Pages

For integrations like Kubernetes or MySQL, groups provide the "home" that's currently missing:

```
Group: "Kubernetes Monitoring"
├── FROM INTEGRATION:
│   ├── Stream: kubernetes-container-logs
│   ├── Stream: kubernetes-pod-metrics
│   ├── Stream: kubernetes-events
│   ├── Dashboard: Cluster Overview
│   ├── Dashboard: Node Resource Usage
│   ├── Dashboard: Pod Health
│   ├── Rule: Node Not Ready
│   ├── Rule: Pod CrashLoopBackOff
│   └── Data View: kubernetes-*
│
├── USER ADDITIONS:
│   ├── Dashboard: Custom K8s Capacity Planning
│   ├── SLO: Cluster Availability (99.99%)
│   ├── Saved Query: Recent pod failures by namespace
│   └── Runbook: K8s Incident Response
│
└── CROSS-REFERENCES:
    ├── → Payment Service Health (service runs on K8s)
    ├── → Inventory Service Health (service runs on K8s)
    └── → Platform Infrastructure (parent group)
```

**Before Groups**: User installs K8s integration. Assets are scattered across Dashboards app, Rules app, Alerts, and various menus. No way to see "everything K8s" in one place.

**After Groups**: User opens K8s group. Single landing page shows all streams, dashboards, rules, SLOs, and custom content for Kubernetes.

### 4.4 Service Health Monitoring Architecture

A comprehensive service monitoring setup using both concepts:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    STREAMS (Data Layer)                              │
├─────────────────────────────────────────────────────────────────────┤
│  payment-logs     postgres-metrics     redis-metrics     kafka-metrics│
│  payment-traces   payment-metrics      inventory-logs    ...         │
└─────────────────────────────────────────────────────────────────────┘
                               ↓
              Stream attachments (what data each asset uses)
                               ↓
┌─────────────────────────────────────────────────────────────────────┐
│                          ASSETS                                      │
├─────────────────────────────────────────────────────────────────────┤
│  Dashboard: Payment Overview      Dashboard: PostgreSQL Performance │
│  Dashboard: Redis Cache Rates     Dashboard: Kafka Consumer Lag     │
│  Query: Cross-backend latency     Query: Error rate by dependency   │
│  Rule: Payment degradation        Rule: DB connection exhaustion    │
│  SLO: Payment availability        SLO: Payment latency P95          │
└─────────────────────────────────────────────────────────────────────┘
                               ↓
              Group membership (how assets are organized)
                               ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    GROUPS (Organization Layer)                       │
├─────────────────────────────────────────────────────────────────────┤
│  Group: "Payment Service Health"                                     │
│  ├── Stream: payment-logs, payment-traces, payment-metrics          │
│  ├── Dashboard: Payment Overview, PostgreSQL Perf, Redis Rates     │
│  ├── Query: Cross-backend latency, Error rate by dependency        │
│  ├── Rule: Payment degradation, DB connection exhaustion           │
│  └── SLO: Payment availability, Payment latency P95                │
│                                                                      │
│  Group: "PostgreSQL Monitoring"     Group: "Redis Monitoring"       │
│  ├── Dashboard: PostgreSQL Perf     ├── Dashboard: Redis Cache Rates│
│  └── Rule: DB connection exhaust    └── Rule: Cache hit rate drop  │
│                                                                      │
│  Group: "Platform Services"                                          │
│  ├── → Payment Service Health (reference)                           │
│  ├── → Inventory Service Health (reference)                         │
│  └── Dashboard: Platform Overview (rollup of all services)         │
└─────────────────────────────────────────────────────────────────────┘
```

Notice how:
- Streams define data pipelines (how data flows)
- Assets are attached to streams (what data they use)
- Groups organize assets by purpose (service health, technology, team)
- Assets can appear in multiple groups (PostgreSQL dashboard in both "Payment Service" and "PostgreSQL Monitoring")

### 4.5 Complementary Queries

Users can query from either direction:

```
# Data-centric query (Streams)
"Show me all dashboards that visualize the postgres-metrics stream"
→ Uses stream attachments
→ Returns: PostgreSQL Performance, PostgreSQL Replication, etc.

# Organization-centric query (Groups)  
"Show me all assets for the Payment Service"
→ Uses group membership
→ Returns: Payment Overview, Cross-backend query, Payment SLO, etc.

# Combined query
"Show me Payment Service dashboards that use PostgreSQL data"
→ Joins both relationships
→ Returns: PostgreSQL Performance (in Payment Service group AND attached to postgres stream)
```

---

## 5. Design Principles

Based on this analysis and the core use cases (service health monitoring, technology/integration monitoring), the Groups plugin follows these principles:

### 5.1 Separation of Concerns

- Groups handles **content organization** (what belongs together for a purpose)
- Streams handles **data management** (how data flows and is processed)
- Neither subsumes the other

### 5.2 Purpose-Centric Design

Groups are designed around user purposes:
- "Monitor the health of the Payment Service"
- "See all assets for Kubernetes monitoring"
- "Organize on-call runbooks and dashboards"

The organizing principle is **why assets belong together**, not what data they use.

### 5.3 Cross-Data-Source Capability

Groups are specifically designed to span multiple data sources:
- A service health group spans logs, traces, metrics, database, cache, and queue streams
- Saved queries that correlate data across streams belong naturally in groups
- Integration groups span all data types for a technology

### 5.4 Streams as Group Members

- Streams are valid asset types for group membership
- This enables organizing data pipelines alongside their supporting assets
- Groups provide a "landing page" that shows both data sources and analysis tools

### 5.5 Independent ACL

- Groups have their own per-group access control
- Group access ≠ Stream access (orthogonal dimensions)
- A developer might access "Payment Service Health" group but have limited access to the underlying database metrics stream

### 5.6 No Data Semantics

- Groups have no schema, processing, or routing concepts
- They are purely organizational constructs
- The complexity of data management stays in Streams

### 5.7 Multi-Membership

- Assets can belong to multiple groups (PostgreSQL dashboard in "Payment Service Health" AND "Database Operations")
- Assets can be attached to streams (PostgreSQL dashboard attached to postgres-metrics stream)
- These are independent, complementary relationships

---

## 6. Summary Comparison

| Aspect | Streams | Groups |
|--------|---------|--------|
| **Purpose** | Data lifecycle management | Content organization |
| **Core question** | "How does data flow?" | "What belongs together?" |
| **Primary use case** | Data pipelines | Service health, integration monitoring |
| **Has schema** | Yes | No |
| **Has processing rules** | Yes | No |
| **Asset relationship meaning** | "Visualizes/monitors this data" | "Serves this purpose" |
| **Typical basis for membership** | Data source | Service, technology, team, project |
| **Can span data sources** | No (1 stream = 1 data flow) | Yes (essential for service monitoring) |
| **Saved queries** | Attached to stream for that data | Stored in group, can span streams |
| **Permission model** | Data access patterns | Service/team ownership |
| **Can contain streams** | No | Yes (streams are assets) |
| **Landing page purpose** | Explore data pipeline | Explore service/integration health |

---

## 7. Conclusion

Groups and Streams are **complementary abstractions** designed for different user needs:

1. **Streams** answer: "How is my data organized and processed?"
2. **Groups** answer: "How is my content organized for my purposes?"

### Key Use Cases Enabled by Groups

**Service Health Monitoring:**
- Group contains streams, dashboards, queries, rules, and SLOs for a service
- Saved queries can correlate data across multiple backends
- Single landing page for "Payment Service Health" or "Inventory Service Health"
- Works across all data sources a service depends on

**Technology/Integration Monitoring:**
- Group contains all assets from an Elastic integration (K8s, MySQL, etc.)
- Provides the "integration home" that doesn't exist today
- Can include custom assets alongside integration-provided ones
- Shows streams, dashboards, rules, data views in one place

### Benefits of Separation

By keeping Groups and Streams separate, we:
- Maintain clear semantics for each concept
- Enable cross-data-source content organization (essential for service monitoring)
- Support saved queries that span multiple streams
- Support independent permission models
- Allow streams to be organized into groups
- Avoid overloading the "stream" concept with organizational duties
- Provide integration landing pages without modifying integration architecture

Users benefit from having both tools available, using each where it's most appropriate. Streams manage data; Groups organize content.

---

*This document accompanies the Groups Plugin Implementation Plan.*
