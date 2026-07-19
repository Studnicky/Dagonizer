---
title: 'The Cartographer'
description: 'A deterministic data-orchestration pipeline powered by Dagonizer: multi-source fan-in, branching conditional routing, offline country-coder geo-resolution, GDPR redaction, and continent insights. The same engine as the Archivist, applied to ETL instead of agents.'
seeAlso:
  - text: 'The Archivist'
    link: './the-archivist'
    description: 'LLM agent orchestration on the same engine'
  - text: 'Concepts'
    link: '../concepts'
    description: 'Dagonizer vocabulary the Cartographer exercises'
  - text: 'Example 04: Scatter Scout'
    link: './04-scatter'
    description: 'streaming scatter + bounded concurrency'
  - text: 'Example 05: Embedded DAGs'
    link: './05-embedded-dags'
    description: 'nested sub-DAG composition'
  - text: 'Visualization'
    link: '../guide/visualization'
    description: 'render a DAG with CytoscapeGraph'
---

# The Cartographer

## What It Is

The Cartographer is a shipment and event workflow around the registered DAG bundle. It streams multi-source intake through conditional routing, offline geo resolution, GDPR redaction, and continent-level aggregation on the same runtime contract the other examples use.

The runtime couples that DAG bundle with worker-backed execution, compare panes, and insight projection so the deterministic pipeline stays visible while it runs.

## Runnable Example

Open [The Cartographer](/examples/the-cartographer) to run the workflow and inspect its execution surfaces directly.

Click **Run** to stream 100 synthetic tracking events through the full pipeline by default. The **DAG Topology** pane lights nodes as worker-backed scatter clones execute; **Stream**, **Insights**, and **Compare** show the live records, routing savings, and before/after payloads. Larger stress runs are available in the **Configuration** tab.

## Flow and Runtime Behavior

The Cartographer runtime runs the DAGs directly. The stream feed, insight tables, compare panes, and DAG state all come from live execution output.

### Runtime behavior

The Cartographer shows how Dagonizer handles non-agent workflows. The same JSON-LD DAG model, scatter/gather machinery, embedded DAGs, worker containers, checkpoint semantics, and visualization APIs run deterministic ETL and streaming workloads in the browser.

It runs on the same `@studnicky/dagonizer` engine as [The Archivist](./the-archivist).
Only the node domain differs: agent reasoning vs data enrichment. The DAG topology,
lifecycle hooks, observer pattern, streaming scatter, and embedded-DAG composition
are identical.

Watch the **Compare** tab after the run: the before/after panel shows raw GPS
coordinates resolved to a real continent/country, and raw PII fields redacted
to their pseudonymised forms. The routing savings table shows how many node
executions the conditional branching avoided.

## How It Works

The interactive host registers real node classes, DAG documents, worker containers, and observers. The visual panes listen to dispatcher lifecycle events and folded output, so the runtime view reflects the actual execution path directly.

### Architecture

Five producer feed DAGs, one open gather, and one shared streaming-enrichment scatter:

```
cartographer (top-level)
  entrypoints: position-ping | facility-scan | sensor-reading | customs-event | delivery-confirmation
  ├─ dag-feed-position-ping         ─┐
  ├─ dag-feed-facility-scan         ─┤
  ├─ dag-feed-sensor-reading        ─┤  each producer feed DAG:
  ├─ dag-feed-customs-event         ─┤    feed-<type> opens that producer's lazy
  └─ dag-feed-delivery-confirmation ─┘      payload stream onto state.sourceFeed → done
  gather('intake-gather', source-intake)   ← open fan-in; merges each clone's stream
                                              into the top-level state['source-payload']
  scatter('process-stream', 'source-payload',
          { dag: 'stream-event' },
          gather: insights-fold,             ← fold into state.insights / state.journeys / state.sampleRecords
          container: 'cpu',                  ← host runtime: WebWorkerContainer role
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
           geo-pipeline  ←  route-geo → validate-coords → geo-source-resolve (six embedded resolver DAG entrypoints → geo-weighted-fusion GatherNode → resolve-country-consensus → [consensus: verify-point-containment → assemble-resolved-geo → resolve-timezone] | [no-consensus: flag-geo-for-review]) | apply-geo
           gdpr-compliance  ←  consent-gate → classify-pii → redact-pii
  embed('summarize-insights', 'insights-summary',
        container: 'io')                     ← host runtime: separate WebWorkerContainer role
    └─ insights-summary
         summarize → done
  done
```

`stream-event` shares its routing and per-type pipeline embeds with
`event-pipeline-typed`, an earlier scatter body kept registered as a
compatibility path; `process-stream` targets `stream-event` directly.

The `insights-fold` gather accumulates each clone's `state.enriched` into three bounded
accumulators (`state.insights`, `state.journeys`, `state.sampleRecords`) as clones
complete. The producer feed fan-in also leaves the merged source-payload batches on
`state['source-payload']` so the Compare pane can show the inputs that
enter the shared enrichment pipeline.

The runtime runs the `process-stream` scatter body through container role
`cpu` and the `summarize-insights` embedded DAG through container role `io`.
`CartographerWorkerContainer` extends `WebWorkerContainer` to spawn a
statically-bundled worker entry so Vite can chunk the registry. The reservoir
`capacity` is a UI-controlled knob: the runner calls
`CartographerWorkersDag.bundle(clampedBatchCapacity)` on each run so the batch
size tracks the visitor's setting without mutating shared constants.

## Code Samples

The Cartographer source shows the data-pipeline side of the same engine. Start with the top-level DAGs, then inspect the routing nodes, state/services, entity shapes, and CLI runner that make the pipeline deterministic.

### Branching conditional routing

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
`EnrichedShipment.routing` value). The parent delegates `summarize-insights` to
the `insights-summary` DAG, which folds these across all records to produce the
savings tally when the streaming gather has not already produced bounded
aggregates.

<<< ../../examples/the-cartographer/nodes/routeGeo.ts#route-geo-node

<<< ../../examples/the-cartographer/nodes/routeRedaction.ts#route-redaction-node

### The DAGs

#### Top-level: `cartographer`

<<< ../../examples/the-cartographer/dag.ts#cartographer-dag

#### Worker-role top-level: `cartographer`

<<< ../../examples/the-cartographer/dag.ts#cartographer-workers-dag

#### Summary body: `insights-summary`

<<< ../../examples/the-cartographer/dag.ts#insights-summary-dag

#### Branching enrichment: `event-pipeline-typed`

<<< ../../examples/the-cartographer/dag.ts#event-pipeline-typed-dag

#### Ingestion sub-DAG: `ingest-source`

The shared transform node chain. Only the subset each format needs runs; the rest is
skipped by the `select-source` routing node.

<<< ../../examples/the-cartographer/embedded-dags/IngestSourceDAG.ts

#### Source-model geo-resolution sub-DAG: `geo-source-resolve`

`geo-source-resolve` has six labeled entrypoints: coords, address, ip, code,
phone, and locale. Each entrypoint embeds a small resolver DAG. The resolver DAG
prepares a `GeoSignalDescriptor` when its modality is present, runs the dedicated
resolver node, and projects `state.candidate` into the parent gather record. The
parent `geo-weighted-fusion` `GatherNode` waits for all six producer labels and
accumulates every weight>0 candidate into `state.geoCandidates`. When no
candidate resolves, the gather writes the baseline `state.resolvedGeo` /
`state.geoContext` directly.

Every signal reflects only where THIS event happened — the code signal reads
the event's own `countryCode` alone, never a fallback to the shipment's
`recipientCountry`. This is a travel log: a scan's location and the package's
eventual destination are different facts, and destination data never
substitutes for a location signal.

When at least one candidate resolved, a layered-consensus chain derives the
combined location instead of crowning a single highest-weight winner, with a
distinct lane for signals that disagree too much to trust:

- `resolve-country-consensus` groups candidates by ISO-2 country (water-status
  candidates form their own pseudo-group) and picks the group with the highest
  SUMMED weight — several independently agreeing signals outrank one
  higher-weight signal asserting a different country alone. Routes `consensus`
  when the winning group clears both an absolute-share floor and a margin over
  the runner-up (a single identity group always reaches consensus — there's
  nothing to tie-break against); routes `no-consensus` otherwise.
- `verify-point-containment` (consensus lane) reverse-geocodes the best
  available point (`OfflineGeoResolver`, offline `country-coder` boundaries)
  and checks it against the consensus country. Agreement marks the point
  verified; a real disagreement is recorded as a conflict rather than silently
  preferred either way. No point candidate falls back to the consensus
  country's centroid (`Geo.centroidForCountry`).
- `assemble-resolved-geo` (consensus lane) writes `state.resolvedGeo`,
  `state.geoContext`, and `state.routing.{geoConfidence,geoModalities,...}`
  from the consensus country and verified position — timezone is left as a
  placeholder. Region/locality/locale back-fill only draws from candidates
  that agree with the consensus country. Confidence is a noisy-OR combination
  of the agreeing group's weights (`1 - Π(1 - weight)`), penalized 0.7× when
  point verification found a conflict.
- `resolve-timezone` (consensus lane) derives the real timezone from the
  FINAL assembled position via `TimeZoneResolver.zoneFor` — never from a
  candidate's self-reported timezone — since timezone depends on where the
  chain settled, not on any one signal.
- `flag-geo-for-review` (no-consensus lane) writes baseline `resolvedGeo`/
  `geoContext` and sets `state.routing.geoFlaggedForReview = true` — a
  visibly distinct DAG lane for locations that need investigation instead of
  being silently blended into the confident-resolution path.

Coords resolution uses `@studnicky/geo-resolver`'s `GeohashTzMap` (a
base64-embedded binary geohash→timezone table, re-exported from
`@studnicky/grid-schemes`) as the fast offline path, with `CoordTimezoneResolver`
(tz-lookup + `@rapideditor/country-coder`) as the browser-safe border/gap
fallback path. Address resolution calls the injected `AddressGeocoder` transport
(Nominatim live; deterministic no-answer in the smoke). Both IP and address
transports are injected per-call so worker threads own independent instances.

<<< ../../examples/the-cartographer/embedded-dags/GeoSourceResolveDAG.ts

<<< ../../examples/the-cartographer/nodes/geo/prepareGeoSignal.ts#prepare-geo-signal-node

<<< ../../examples/the-cartographer/nodes/geo/resolveCountryConsensus.ts#resolve-country-consensus-node

<<< ../../examples/the-cartographer/nodes/geo/verifyPointContainment.ts#verify-point-containment-node

<<< ../../examples/the-cartographer/nodes/geo/assembleResolvedGeo.ts#assemble-resolved-geo-node

<<< ../../examples/the-cartographer/nodes/geo/resolveTimezone.ts#resolve-timezone-node

<<< ../../examples/the-cartographer/nodes/geo/flagGeoForReview.ts#flag-geo-for-review-node

#### GDPR compliance sub-DAG: `gdpr-compliance`

<<< ../../examples/the-cartographer/embedded-dags/GdprComplianceDAG.ts

### State and services

#### `CartographerState`

The mutable clipboard threaded through every node. Top-level fields hold the
source feeds, ingested events, gathered records, and insights aggregates. Clone
fields hold the per-event enrichment pipeline's intermediate values.

<<< ../../examples/the-cartographer/CartographerState.ts#cartographer-state

#### `CartographerServices`

The dependency record passed into node constructors. Services carry two
transport adapters: `ipGeolocator` (live `freeipapi.com` or committed fixture
replay) and `addressGeocoder` (live OpenStreetMap Nominatim or deterministic
no-answer in the smoke). Coords, locale, code, and phone resolution are fully
offline — `GeohashTzMap`, `CoordTimezone`, and `CallingCode` need no injected
transport.

<<< ../../examples/the-cartographer/CartographerServices.ts#cartographer-services

#### `GeoResolvers`

Factory that assembles the `CartographerServices` record for the chosen backend.

<<< ../../examples/the-cartographer/services/GeoResolvers.ts#geo-resolvers

### Key nodes

#### `producerFeeds` and `SourceIntakeGather` — producer DAG fan-in

Each data-type entrypoint targets its own producer stream-feed DAG. That DAG
opens the producer-local source stream, scatters each source payload through
`ingest-source` for decompress/parse/normalize/validate, and returns source
payload batches to the top-level `intake-gather` placement. The `source-intake`
gather is the open fan-in that merges those producer DAG outputs into the
single shared `source-payload` collection the enrichment scatter reads.

<<< ../../examples/the-cartographer/nodes/producerFeeds.ts#producer-feed-nodes

<<< ../../examples/the-cartographer/embedded-dags/ProducerFeedDAG.ts#producer-feed-dags

<<< ../../examples/the-cartographer/core/SourceIntakeGather.ts#source-intake-gather

#### `canonicalizeCore` — timestamp and location normalization

After geo-enrichment sets `state.geoContext.timezone`, `canonicalizeCore` converts the
raw timestamp to a UTC epoch, then derives the local time at the scan's IANA timezone
using `Intl.DateTimeFormat`. Cross-zone journeys show different local times and UTC
offsets per scan.

<<< ../../examples/the-cartographer/nodes/canonicalizeCore.ts#canonicalize-core-node

#### `aggregateEvent` — writes the enriched record

Pulls every enrichment result out of the clone's state and assembles the compact
`EnrichedShipment` record. The routing decisions, redacted PII sample, and pricing/
shipping/ETA figures all land here.

<<< ../../examples/the-cartographer/nodes/aggregateEvent.ts#aggregate-event-node

#### `summarizeInsights` — finalize insight views

In the streaming path (the Cartographer workflow and any caller using `insights-fold`) the
`insights-fold` gather accumulates `state.insights`, `state.journeys`, and
`state.sampleRecords` incrementally as each clone completes, so `summarizeInsights`
is a pure pass-through — it detects the pre-populated maps and routes `success`
immediately. The records-based fold (iterating `state.records`) is retained as a
default path for callers that use the array path without the `insights-fold` gather.
Either way the final state exposes:

- **Per-continent rollup** (`state.insights`): counts, on-time rate, revenue (USD), distance.
- **Per-journey rollup** (`state.journeys`): grouped by `shipmentId`, ordered by epoch;
  path distance, elapsed time, timezones crossed, jurisdictions traversed.

<<< ../../examples/the-cartographer/nodes/summarizeInsights.ts#summarize-insights-node

### Entities

#### `EnrichedShipment` — the per-scan enriched record

<<< ../../examples/the-cartographer/entities/EnrichedShipment.ts#enriched-shipment-entity

#### `CanonicalEventVariant` — the per-type event model

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

#### `GeoContext` — geo-enrichment result

<<< ../../examples/the-cartographer/entities/GeoContext.ts#geo-context-entity

### CLI

```bash
# Run with 200 journeys (live IP geolocation when network reachable):
npx tsx examples/the-cartographer/runCartographer.ts

# Force offline / recorded mode:
npx tsx examples/the-cartographer/runCartographer.ts --recorded

# Custom event count:
npx tsx examples/the-cartographer/runCartographer.ts --events 50
```

<<< ../../examples/the-cartographer/runCartographer.ts#run-cartographer

## Operational Uses

The Cartographer shows Dagonizer with no LLM in the loop. It is a streaming data pipeline with typed inputs, bounded fan-out, conditional routing, worker-backed processing, and aggregate outputs.

The same runtime handles ETL-shaped work with real branching, backpressure, and data-quality decisions, and the host keeps skipped work as visible as completed work.

### Exercise the flow

Click **Run** and watch the stream, DAG, and panels while synthetic shipment events move through parsing, geo-resolution, GDPR compliance, worker-backed stream processing, and insight aggregation. Compare the routing-savings table with the highlighted DAG path.

## Runtime Notes

### The thesis

> **Data orchestration = the same engine.** LLM-agent workflows and
> deterministic ETL pipelines are both DAGs of typed nodes with state.
> The engine does not know or care whether a node calls an LLM, decodes
> CSV, or runs a haversine formula.

The Cartographer makes the value of the DAG concrete: **deterministic
conditional routing skips unnecessary work**. A position-ping that already
carries resolved geo never touches the geo-resolution sub-DAG. An event
with no PII never touches the GDPR redaction sub-DAG. The savings are
visible in the routing table.

### Offline geo resolution

Coords resolution uses two offline primitives from `@studnicky/geo-resolver`
(and its `@studnicky/grid-schemes` dependency) — no HTTP, no key, deterministic,
identical in Node 18+ and the browser:

- **`GeohashTzMap`** — a base64-embedded binary geohash→timezone lookup table.
  The primary fast path: a single table scan resolves lat/lng to an IANA timezone
  with no network call.
- **`CoordTimezoneResolver`** — `tz-lookup` + `@rapideditor/country-coder`. The
  browser-safe fallback path for border regions and gaps where the geohash table
  is ambiguous. It guards the `RangeError` that out-of-range coords would otherwise
  raise: when a coord pair falls outside all known boundaries, resolution degrades
  to an empty timezone/country rather than throwing, and the event continues through
  the pipeline at baseline.

Locale and code resolution are also fully offline (BCP-47 → IANA via
`LocaleTimezone`; ISO-2 → locale via `CountryLocale`), all from the same package.
The only live network call in the geo path is IP geolocation (`freeipapi.com`,
CORS-enabled, no key), or committed fixture replay in the smoke tests.

Cartographer's geo nodes (`prepareGeoSignal`, `scoreSignals`, `resolveCoords`,
`resolveCode`, `resolveLocale`, `resolvePhone`) own the DAG shape — the per-signal
scatter/gather fan-out that the topology graph renders — but delegate the actual
lookups to `@studnicky/geo-resolver`'s primitives rather than hand-maintaining
country/timezone/locale tables locally.

## Related Concepts

These related pages connect Cartographer behavior to scatter, embedded DAGs, workers, streaming, and plugin-defined reusable flows.

- [The Archivist](./the-archivist) - LLM agent orchestration on the same engine
- [Concepts](../concepts) - Dagonizer vocabulary the Cartographer exercises
- [Example 04: Scatter Scout](./04-scatter) - streaming scatter + bounded concurrency
- [Example 05: Embedded DAGs](./05-embedded-dags) - nested sub-DAG composition
- [Visualization](../guide/visualization) - render a DAG with CytoscapeGraph

### Cartographer Feature Map

These numbered examples are the small-form counterparts to Cartographer behavior:

| Example | Principle in the Cartographer workflow |
|---------|-----------------------------------------|
| [Example 04C: Container-Bound Scatter](./04c-scatter-workers) | `process-stream` is a scatter placement with a container role; the numbered example isolates the worker-bound body shape. |
| [Example 12: Worker Containers](./12-workers) | The shared typed event pipeline runs through the same `DagContainerInterface` seam when container roles are bound. |
| [Example 13: Multi-Backend Roles](./13-multibackend) | `process-stream` binds to `cpu` and `summarize-insights` binds to `io` in the browser Cartographer runner while the parent DAG stays JSON-LD. |
| [Example 14: Gather Strategies](./14-gather-strategies) | Cartographer’s `InsightsFoldGather` and first-class `geo-weighted-fusion` gather show scatter-local folds and embedded-producer fan-in. |
| [Example 15: Incremental Gather](./15-incremental-gather) | The insights panel updates through incremental fold semantics rather than waiting for a final batch merge. |
| [Example 16: Scatter Resume](./16-scatter-resume) | The durable-inbox model is the checkpoint substrate for long-running stream scatters. |
| [Example 17: Async Scatter Source](./17-scatter-async-source) | `seed` can provide sources as an async stream; bounded scatter pulls only as capacity opens. |
| [Example 27: Runtime DAG Dispatch](./27-recursion) | Dynamic `DagReference` dispatch belongs here if hierarchical route expansion enters the workflow. |
| [Example 33: Plugin-Defined DAGs](./33-plugin) | Plugin packaging belongs here for normalization pipelines (`NormalizeCsvDAG`, `NormalizeJsonDAG`, etc.) so plugins and embedded DAGs stay one interface. |
| [Examples 34-36: Streaming Substrate](./34-stream-channel) | Intake stream assembly, resumable cursors, and DagStreamProducer are the substrate beneath Cartographer’s event stream. |
