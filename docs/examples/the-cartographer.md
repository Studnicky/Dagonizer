---
title: 'The Cartographer'
description: 'A deterministic data-orchestration pipeline built on Dagonizer: multi-source fan-in, branching conditional routing, offline country-coder geo-resolution, GDPR redaction, and continent insights. The same engine as the Archivist — applied to ETL instead of agents.'
seeAlso:
  - text: 'The Archivist (in-browser demo)'
    link: './the-archivist'
    description: 'LLM agent orchestration on the same engine'
  - text: 'Concepts'
    link: '../concepts'
    description: 'Dagonizer vocabulary the Cartographer exercises'
  - text: 'Phase 04: Scatter scout'
    link: './04-scatter'
    description: 'streaming scatter + bounded concurrency'
  - text: 'Phase 05: EmbeddedDAGNode composition'
    link: './05-embedded-dags'
    description: 'nested sub-DAG composition'
  - text: 'Visualization'
    link: '../guide/visualization'
    description: 'render a DAG with CytoscapeGraph'
---

# The Cartographer

The Cartographer is a deterministic data-orchestration pipeline that ingests
multi-format satellite tracking feeds, routes each event only through the nodes
it needs, and aggregates continent-level insights with GDPR-compliant PII
handling — all without an LLM, without a GPU, running entirely in your browser.

It runs on the same `@studnicky/dagonizer` engine as [The Archivist](./the-archivist).
Only the node domain differs: agent reasoning vs data enrichment. The DAG topology,
lifecycle hooks, observer pattern, streaming scatter, and embedded-DAG composition
are identical.

Try it live below. Click **Run** to stream 21 synthetic tracking events (the
default: 6 position-pings, 5 facility-scans, 4 sensor-readings, 3 customs-events,
3 delivery-confirmations) through the full pipeline. Watch the **DAG** pane: nodes
light cyan while executing, edges flash when traversed, and branching skips are
visible as edges that never fire.

<CartographerRunner />

Watch the **Panels** tab after the run: the before/after panel shows raw GPS
coordinates resolved to a real continent/country, and raw PII fields redacted
to their pseudonymised forms. The routing savings table shows how many node
executions the conditional branching avoided.

## The thesis

> **Data orchestration = the same engine.** Agentic LLM workflows and
> deterministic ETL pipelines are both DAGs of typed nodes with state.
> The engine does not know or care whether a node calls an LLM, decodes
> CSV, or runs a haversine formula.

The Cartographer makes the value of the DAG concrete: **deterministic
conditional routing skips unnecessary work**. A position-ping that already
carries resolved geo never touches the geo-resolution sub-DAG. An event
with no PII never touches the GDPR redaction sub-DAG. The savings are
visible in the routing table.

## Architecture

Four DAGs, two scatters, and three embedded sub-DAGs:

```
cartographer (top-level)
  phase('seed')                         ← pre-phase: build multi-format source feeds
  scatter('ingest-sources', 'sources')  ← FAN-IN: one run of ingest-source per feed
    └─ ingest-source                    ← per-source: decompress → parse → map → validate
  merge-events                          ← flatten per-source buckets → canonicalEvents
  scatter('process-events', 'canonicalEvents', concurrency=16)  ← STREAMING
    └─ event-pipeline                   ← per-event: BRANCHING enrichment
         ├─ route-geo (skip or run geo-resolve sub-DAG)
         │    └─ geo-resolve            ← reverse-geocode ∥ ip-geolocate → fuse-geo
         ├─ normalize → classify → route-kind (geo-only | sensor | order | customs)
         ├─ route-redaction (skip or run gdpr-compliance sub-DAG)
         │    └─ gdpr-compliance        ← consent-gate → classify-pii → redact-pii
         └─ aggregate-event
  summarize → done
```

The top-level `cartographer` DAG uses **two streaming scatters**:

1. **Ingestion fan-in** (`ingest-sources`): source feeds across five event types
   (position-ping, facility-scan, sensor-reading, customs-event, delivery-confirmation),
   each encoded across a configurable format mix (csv/json/ndjson/yaml with per-format
   weights and compression), each run their own `ingest-source` sub-DAG in an isolated
   clone. The `append` gather concatenates each clone's decoded `ingestedEvents` into one
   `ingestBuckets` array; `merge-events` flattens it into the unified `canonicalEvents`
   collection. Shared transform nodes (`decompress`, `parse-csv`, `parse-json`,
   `parse-ndjson`, `map-fields`, `coerce-types`, `validate-event`) are reused across
   every source — the format only changes which subset runs.

2. **Streaming enrichment** (`process-events`): processes the merged canonical events
   at concurrency 16. Each event clone runs the full `event-pipeline` branching DAG and
   produces one compact `EnrichedShipment`. The `append` gather collects all enriched
   records into `state.records`.

## Branching conditional routing

The `event-pipeline` DAG routes each event only through the nodes it needs. Two
skip conditions are the headline:

- **`route-geo`**: a position-ping that already carries resolved geo (country,
  continent, region from the JSON source) routes to `apply-geo` and never enters
  the `geo-resolve` sub-DAG. Both real API calls (reverse-geocode + IP geolocation)
  are avoided.
- **`route-redaction`**: an event with no PII fields, or one whose consent/jurisdiction
  does not require processing, routes to `skip-redaction` and never enters the
  `gdpr-compliance` sub-DAG.

Each routing node records its decision on the clone's `state.routing` object (a
`EnrichedShipment.routing` value). The parent's `summarize` node folds these across
all records to produce the savings tally.

<<< ../../examples/the-cartographer/nodes/routeGeo.ts#route-geo-node

<<< ../../examples/the-cartographer/nodes/routeRedaction.ts#route-redaction-node

## The DAGs

### Top-level: `cartographer`

<<< ../../examples/the-cartographer/dag.ts#cartographer-dag

### Branching enrichment: `event-pipeline-typed`

<<< ../../examples/the-cartographer/dag.ts#event-pipeline-typed-dag

### Ingestion sub-DAG: `ingest-source`

The shared transform node chain. Only the subset each format needs runs; the rest is
skipped by the `select-source` routing node.

<<< ../../examples/the-cartographer/embedded-dags/IngestSourceDAG.ts

### Geo-resolution sub-DAG: `geo-resolve`

<<< ../../examples/the-cartographer/embedded-dags/GeoResolveDAG.ts

### GDPR compliance sub-DAG: `gdpr-compliance`

<<< ../../examples/the-cartographer/embedded-dags/GdprComplianceDAG.ts

## State and services

### `CartographerState`

The mutable clipboard threaded through every node. Top-level fields hold the
source feeds, ingested events, gathered records, and insights aggregates. Clone
fields hold the per-event enrichment pipeline's intermediate values.

<<< ../../examples/the-cartographer/CartographerState.ts#cartographer-state

### `CartographerServices`

The services bag injected via `Dagonizer` constructor options. Geo resolution uses
swappable transport adapters: the GPS modality is always the offline
`@rapideditor/country-coder` (deterministic, no HTTP); the IP modality uses the live
`freeipapi.com` API online or recorded fixture replay for the smoke tests.

<<< ../../examples/the-cartographer/CartographerServices.ts#cartographer-services

### `GeoResolvers`

Factory that assembles the `CartographerServices` bag for the chosen backend.

<<< ../../examples/the-cartographer/services/GeoResolvers.ts#geo-resolvers

## Key nodes

### `seedEvents` — pre-phase

The `pre`-phase node runs before the DAG entrypoint. It calls
`Sources.buildTypedFeed(state.eventConfig)` (finite path) or sets `state.sources` to an
`AsyncIterable<SourcePayload>` from `EventStreamSource.streamTyped(state.eventConfig, state.streamCount)`
(streaming path) and writes the result to `state.sources`. The ingestion scatter then reads
`state.sources` by path.

<<< ../../examples/the-cartographer/nodes/seedEvents.ts#seed-events-node

### `canonicalizeCore` — timestamp and location normalization

After geo-enrichment sets `state.geoContext.timezone`, `canonicalizeCore` converts the
raw timestamp to a UTC epoch, then derives the local time at the scan's IANA timezone
using `Intl.DateTimeFormat`. Cross-zone journeys show different local times and UTC
offsets per scan.

<<< ../../examples/the-cartographer/nodes/canonicalizeCore.ts#canonicalize-core-node

### `aggregateEvent` — writes the enriched record

Pulls every enrichment result out of the clone's state and assembles the compact
`EnrichedShipment` record. The routing decisions, redacted PII sample, and pricing/
shipping/ETA figures all land here.

<<< ../../examples/the-cartographer/nodes/aggregateEvent.ts#aggregate-event-node

### `summarizeInsights` — fold into two views

After all scatter clones complete, `summarizeInsights` folds `state.records` into:

- **Per-continent rollup** (`state.insights`): counts, on-time rate, revenue (USD), distance.
- **Per-journey rollup** (`state.journeys`): grouped by `shipmentId`, ordered by epoch;
  path distance, elapsed time, timezones crossed, jurisdictions traversed.

<<< ../../examples/the-cartographer/nodes/summarizeInsights.ts#summarize-insights-node

## Entities

### `EnrichedShipment` — the per-scan enriched record

<<< ../../examples/the-cartographer/entities/EnrichedShipment.ts#enriched-shipment-entity

### `CanonicalEventVariant` — the per-type event model

The canonical model is a discriminated union on `eventType`. Each member carries only
the fields its event type owns. Five types are generated:

- `position-ping` — a moving asset's satellite position fix with GPS coordinates
- `facility-scan` — a parcel scanned at a depot or facility; carries PII and order fields
- `sensor-reading` — cold-chain telemetry (temperature, humidity, shock); triggers the cold-chain check
- `customs-event` — a customs clearance or hold event; carries `customsStatus`
- `delivery-confirmation` — proof-of-delivery (the terminal event); carries PII and `delivered: true`

Format is an independent axis: each event type specifies a format mix (csv/json/ndjson/yaml
with per-format weights and compression), so position-pings might arrive as gzip JSON while
facility-scans come as CSV. The same event type can appear in multiple formats in one feed.

<<< ../../examples/the-cartographer/entities/CanonicalEvent.ts#canonical-event-variant-entity

### `GeoContext` — geo-enrichment result

<<< ../../examples/the-cartographer/entities/GeoContext.ts#geo-context-entity

## Offline geo resolution

GPS reverse-geocode uses the offline `@rapideditor/country-coder` boundary dataset —
no HTTP, no key, deterministic, runs identically in Node 18+ and the browser. IP
geolocation uses the live `freeipapi.com` API (CORS-enabled, no key), or a committed
fixture replay in the smoke tests.

<<< ../../examples/the-cartographer/services/OfflineReverseGeocoder.ts#offline-reverse-geocoder

## CLI

```bash
# Run with 200 journeys (live IP geolocation when network reachable):
npx tsx examples/the-cartographer/runCartographer.ts

# Force offline / recorded mode:
npx tsx examples/the-cartographer/runCartographer.ts --recorded

# Custom event count:
npx tsx examples/the-cartographer/runCartographer.ts --events 50
```

<<< ../../examples/the-cartographer/runCartographer.ts#run-cartographer
