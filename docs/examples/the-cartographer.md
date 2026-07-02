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

<ClientOnly>
  <CartographerRunner />
</ClientOnly>

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

One top-level scatter and a tree of per-type embedded pipeline DAGs:

```
cartographer (top-level)
  phase('seed')                              ← pre-phase: build state.sources (array or AsyncIterable)
  scatter('process-stream', 'sources',       ← STREAMING: one run of stream-event per source payload
          { dag: 'stream-event' },
          gather: insights-fold,             ← O(1) fold into state.insights / state.journeys / state.sampleRecords
          container: 'cpu',                  ← browser demo: WorkerThreadContainer (real OS threads)
          execution: { mode: 'reservoir', concurrency: 16, reservoir: { keyField: 'eventType', capacity } })
    └─ stream-event                          ← decode-payload → route-event-type-variant
         ├─ position-ping       ──► pipeline-position-ping    (parse → geo-pipeline → enrich-leg → aggregate)
         ├─ sensor-reading      ──► pipeline-sensor-reading   (parse → geo-pipeline → cold-chain → enrich-leg → aggregate)
         ├─ customs-event       ──► pipeline-customs-event    (parse → geo-pipeline → customs-dwell → enrich-leg → aggregate)
         ├─ facility-scan       ──► pipeline-facility-scan    (parse → geo-pipeline → canonicalize-facility
         │                                                      → order-enrichment → gdpr-compliance → aggregate)
         └─ delivery-confirmation ► pipeline-delivery-confirmation (parse → geo-pipeline → canonicalize-recipient
                                                                    → confirm-delivery → gdpr-compliance → aggregate)
         Each per-type pipeline embeds:
           geo-pipeline  ←  route-geo → validate-coords → geo-source-resolve (score-signals → scatter[resolve-one-signal: route-signal → resolve-coords/-address/-ip/-code/-phone/-locale] → geo-weighted-fusion gather) | apply-geo
           gdpr-compliance  ←  consent-gate → classify-pii → redact-pii
  summarize → done
```

The `insights-fold` gather accumulates each clone's `state.enriched` into three bounded
accumulators (`state.insights`, `state.journeys`, `state.sampleRecords`) as clones
complete. Memory is O(1) regardless of event count — the parent state never holds a
full copy of every record at once.

The browser demo runs the `process-stream` scatter body in real OS threads via
`CartographerWorkersDag.build(capacity)` (which binds `container: 'cpu'` on the scatter).
`CartographerWorkerContainer` extends `WebWorkerContainer` to spawn a statically-bundled
worker entry so Vite can chunk the registry. The reservoir `capacity` is a UI-controlled
knob: the runner calls `CartographerWorkersDag.bundle(clampedBatchCapacity)` on each run
so the batch size tracks the visitor's setting without mutating shared constants.

## Branching conditional routing

Each per-type pipeline DAG routes the event only through the nodes it needs. Two
skip conditions are the headline:

- **`route-geo`**: a position-ping that already carries resolved geo (country,
  continent, region from the JSON source) routes to `apply-geo` and never enters
  the `geo-source-resolve` sub-DAG. The entire source-model geo lookup — offline
  coords/locale/code resolution and the IP geolocation network call — is skipped.
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

### Source-model geo-resolution sub-DAG: `geo-source-resolve`

`score-signals` inspects the canonical event body and emits one
`GeoSignalDescriptor` per present, valid signal modality (coords, address, ip,
code, phone, locale). Each descriptor carries the modality kind and its base
weight from `SignalWeight`. The scatter fans out one clone per descriptor and
runs the `resolve-one-signal` sub-DAG in each: `route-signal` reads the
descriptor kind and routes it to the dedicated per-concept resolver node —
`resolve-coords`, `resolve-address`, `resolve-ip`, `resolve-code`,
`resolve-phone`, or `resolve-locale` (with `resolve-none` for an unrecognised
signal). Each resolver writes a weighted candidate, and the
`geo-weighted-fusion` gather folds all resolved candidates by weight into
`state.resolvedGeo`, `state.geoContext`, and
`state.routing.{geoConfidence,geoModalities}`. When no signals score, the
engine short-circuits the scatter and routes to `geo-baseline`, which writes
the same baseline values directly.

Coords resolution uses `GeohashTzMap` (a base64-embedded binary
geohash→timezone table) as the fast offline path, with `CoordTimezone`
(tz-lookup + `@rapideditor/country-coder`) as the browser-safe border/gap
fallback. Address resolution calls the injected `AddressGeocoder` transport
(Nominatim live; deterministic no-answer in the smoke). Both IP and address
transports are injected per-call so worker threads own independent instances.

<<< ../../examples/the-cartographer/embedded-dags/GeoSourceResolveDAG.ts

<<< ../../examples/the-cartographer/nodes/geo/scoreSignals.ts#score-signals-node

### GDPR compliance sub-DAG: `gdpr-compliance`

<<< ../../examples/the-cartographer/embedded-dags/GdprComplianceDAG.ts

## State and services

### `CartographerState`

The mutable clipboard threaded through every node. Top-level fields hold the
source feeds, ingested events, gathered records, and insights aggregates. Clone
fields hold the per-event enrichment pipeline's intermediate values.

<<< ../../examples/the-cartographer/CartographerState.ts#cartographer-state

### `CartographerServices`

The dependency record passed into node constructors. Services carry two
transport adapters: `ipGeolocator` (live `freeipapi.com` or committed fixture
replay) and `addressGeocoder` (live OpenStreetMap Nominatim or deterministic
no-answer in the smoke). Coords, locale, code, and phone resolution are fully
offline — `GeohashTzMap`, `CoordTimezone`, and `CallingCode` need no injected
transport.

<<< ../../examples/the-cartographer/CartographerServices.ts#cartographer-services

### `GeoResolvers`

Factory that assembles the `CartographerServices` record for the chosen backend.

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

### `summarizeInsights` — finalize insight views

In the streaming path (the browser demo and any caller using `insights-fold`) the
`insights-fold` gather accumulates `state.insights`, `state.journeys`, and
`state.sampleRecords` incrementally as each clone completes, so `summarizeInsights`
is a pure pass-through — it detects the pre-populated maps and routes `success`
immediately. The records-based fold (iterating `state.records`) is retained as a
fallback for callers that use the array path without the `insights-fold` gather.
Either way the final state exposes:

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

Coords resolution uses two offline primitives — no HTTP, no key, deterministic,
identical in Node 18+ and the browser:

- **`GeohashTzMap`** — a base64-embedded binary geohash→timezone lookup table.
  The primary fast path: a single table scan resolves lat/lng to an IANA timezone
  with no network call.
- **`CoordTimezone`** — `tz-lookup` + `@rapideditor/country-coder`. The browser-safe
  fallback for border regions and gaps where the geohash table is ambiguous.
  `CoordTimezone` guards the `RangeError` that out-of-range coords would otherwise
  raise: when a coord pair falls outside all known boundaries, resolution degrades
  to an empty timezone/country rather than throwing, and the event continues through
  the pipeline at baseline.

Locale and code resolution are also fully offline (BCP-47 → IANA via `LocaleTimezone`;
ISO-2 → timezone via `CountryLocale`). The only live network call in the geo path is
IP geolocation (`freeipapi.com`, CORS-enabled, no key), or committed fixture replay
in the smoke tests.

<<< ../../examples/the-cartographer/geo/CoordTimezone.ts

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
