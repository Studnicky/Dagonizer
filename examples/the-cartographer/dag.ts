/**
 * The Cartographer: DAGs proving data orchestration = the same engine, on a
 * multi-source ingestion fan-in + a streaming enrichment scatter.
 *
 * 1. cartographer (top-level):
 *    seed (pre-phase: build the multi-format source feeds)
 *      → scatter('ingest-sources', 'sources', { dag: 'ingest-source' },
 *                gather: append ingestedEvents → canonicalEvents)   [THE FAN-IN]
 *      → scatter('process-events', 'canonicalEvents', { dag: 'event-pipeline' },
 *                gather: append enriched → records)                 [STREAMING]
 *      → summarize → done
 *
 * 2. ingest-source (ingestion scatter body, one run per source feed):
 *    select-source → (decompress?) → route-format
 *      → parse-{csv,json,ndjson,yaml} → [normalize-{csv,json,ndjson,yaml}]
 *      → coerce-types → validate-event → ingested
 *    (compression is orthogonal; each format has its own parse + normalize sub-DAG;
 *     see embedded-dags/IngestSourceDAG.ts)
 *
 * 3. event-pipeline (enrichment scatter body, one run per canonical event):
 *    parse (canonical → raw) → validate-coords → geo-grid → geo-context
 *      → normalize → classify → enrich-pricing → enrich-shipping → enrich-eta
 *      → enrich-leg → gdpr (embedded) → aggregate-event → done
 *    (Stage 1: LINEAR / always-run enrichment — no skip-routing yet.)
 *
 * 4. gdpr-compliance (embedded in event-pipeline).
 *
 * Fan-in mechanism: the ingestion scatter over `state.sources` (a few fixed
 * source feeds) runs each source's `ingest-source` sub-DAG in an isolated clone
 * and gathers each clone's `ingestedEvents` via the engine's `append` strategy
 * into one `state.canonicalEvents` collection. The streaming enrichment scatter
 * then processes that merged collection. Two scatters: ingestion fan-in +
 * streaming enrichment, both native engine combinators.
 */

// #region cartographer-dag-imports
import { parseEvent }        from './nodes/parseEvent.ts';
import { routeGeo }          from './nodes/routeGeo.ts';
import { applyGeo }          from './nodes/applyGeo.ts';
import { validateCoords }    from './nodes/validateCoords.ts';
import { routeKind }         from './nodes/routeKind.ts';
import { coldChainCheck }    from './nodes/coldChainCheck.ts';
import { customsDwell }      from './nodes/customsDwell.ts';
import { enrichLeg }         from './nodes/enrichLeg.ts';
import { routeRedaction }    from './nodes/routeRedaction.ts';
import { aggregateEvent }    from './nodes/aggregateEvent.ts';
import { mergeEvents }       from './nodes/mergeEvents.ts';
import { summarizeInsights } from './nodes/summarizeInsights.ts';
import { seedEvents }        from './nodes/seedEvents.ts';

import type { CartographerState } from './CartographerState.ts';
import type { CartographerServices } from './CartographerServices.ts';

import type { DAG, DispatcherBundle } from '@noocodex/dagonizer';
import { DAGBuilder } from '@noocodex/dagonizer';
// #endregion cartographer-dag-imports

// ── DAG 1: cartographer (top-level) ─────────────────────────────────────────

// #region cartographer-dag
export const cartographerDAG: DAG = new DAGBuilder('cartographer', '1.0')

  // Pre-phase: seeds state.sources = Sources.buildFromConfig(state.feedConfig) — the
  // multi-format source feeds — before the ingestion scatter reads them.
  .phase('seed', 'pre', seedEvents)

  // Ingestion FAN-IN: scatter over the source feeds; each runs its ingest-source
  // sub-DAG in an isolated clone; the append gather appends each clone's
  // state.ingestedEvents array as one bucket of state.ingestBuckets.
  .scatter(
    'ingest-sources',
    'sources',
    { 'dag': 'ingest-source' },
    {
      'all-success': 'merge-events',
      'partial':     'merge-events',
      'all-error':   'merge-events',
      'empty':       'merge-events',
    },
    {
      'itemKey':     'source',
      'concurrency': 4,
      'gather': {
        'strategy': 'append',
        'field':    'ingestedEvents',
        'target':   'ingestBuckets',
      },
    },
  )

  // merge-events: flatten the per-source buckets into one canonicalEvents model.
  .node('merge-events', mergeEvents, {
    'merged': 'process-events',
  })

  // Streaming enrichment: scatter over the merged canonical events at
  // concurrency 16. Each clone's state.enriched is appended into state.records.
  .scatter(
    'process-events',
    'canonicalEvents',
    { 'dag': 'event-pipeline' },
    {
      'all-success': 'summarize',
      'partial':     'summarize',
      'all-error':   'summarize',
      'empty':       'summarize',
    },
    {
      'itemKey':     'canonical-event',
      'concurrency': 16,
      'gather': {
        'strategy': 'append',
        'field':    'enriched',
        'target':   'records',
      },
    },
  )

  // Fold gathered records into the fixed-size regional + per-journey insights.
  .node('summarize', summarizeInsights, {
    'success': 'done',
  })

  .terminal('done', { outcome: 'completed' })

  .build();
// #endregion cartographer-dag

// ── DAG 2: event-pipeline (one run per canonical event) ──────────────────────

// #region event-pipeline-dag
/**
 * event-pipeline (BRANCHING — the headline): each event routes ONLY through the
 * nodes it needs. Four embedded sub-DAGs compose the domain logic; the parent is
 * a thin orchestrator. Three conditional branches + per-kind enrichment lanes,
 * all converging on aggregate-event:
 *
 *   parse ─invalid→ rejected
 *         └parsed→ route-geo
 *                   ├has-geo→  apply-geo ──────────────┐  (SKIP geo-resolve lookup)
 *                   └needs-geo→ validate-coords         │
 *                                ├rejected→ rejected    │
 *                                └valid→ [geo-resolve]──┘ (embedded: reverse-geocode+ip+fuse)
 *                                                        ▼ (converge)
 *                                                [canonicalize] (embedded: normalize → classify)
 *                                                        ▼
 *                                                   route-kind
 *      ┌──────────────────────────────────────────────────────────────────────┘
 *      ├geo-only (position-ping)→ enrich-leg
 *      ├sensor   (sensor-reading)→ cold-chain-check → enrich-leg
 *      ├order    (facility-scan / delivery-confirmation)→
 *      │            [order-enrichment] (embedded: pricing→shipping→eta) → enrich-leg
 *      └customs  (customs-event)→ customs-dwell → enrich-leg
 *                                                   ▼ (converge)
 *                                              route-redaction
 *                                               ├needs-redaction→ [gdpr] → aggregate-event
 *                                               └skip-redaction→ aggregate-event (direct bypass)
 *   aggregate-event ─done→ done
 *
 * Each routing decision is recorded on the clone's state.routing (RAN vs
 * SKIPPED) and copied onto the enriched record so summarize totals the savings.
 */
export const eventPipelineDAG: DAG = new DAGBuilder('event-pipeline', '1.0')

  // 1. parse: adapt the canonical event (from metadata) into state.raw.
  .node('parse', parseEvent, {
    'parsed':  'route-geo',
    'invalid': 'rejected',
  })

  // 2. route-geo: SKIP the geo lookup when the source pre-resolved location.
  .node('route-geo', routeGeo, {
    'has-geo':   'apply-geo',
    'needs-geo': 'validate-coords',
  })

  // 2a. apply-geo (skip path): materialise GeoContext from carried geo.
  .node('apply-geo', applyGeo, {
    'normalize': 'canonicalize',
  })

  // 2b. validate-coords (lookup path): WGS-84 bounds check on the scan coords.
  .node('validate-coords', validateCoords, {
    'valid':    'geo-resolve',
    'rejected': 'rejected',
  })

  // 2c. geo-resolve: embedded multi-modal geo-resolution sub-DAG (REAL APIs):
  //     reverse-geocode ∥ ip-geolocate → fuse-geo. Writes state.geoContext +
  //     state.resolvedGeo. This is the work route-geo SKIPS when geo is
  //     pre-resolved (both real API calls avoided).
  .embeddedDAG<CartographerState, CartographerState>('geo-resolve', 'geo-resolve', {
    'success': 'canonicalize',
    'error':   'canonicalize',
  }, {
    'inputs': {
      // Seed the child with the fields the geo nodes read + the routing record
      // route-geo already started, so the child's geo-call flags accumulate onto it.
      'raw':       'raw',
      'canonical': 'canonical',
      'routing':   'routing',
    },
    'outputs': {
      'geoContext':  'geoContext',
      'resolvedGeo': 'resolvedGeo',
      'routing':     'routing',
    },
  })

  // 3. canonicalize: embedded sub-DAG that normalizes scalars and classifies the
  //    event. Runs AFTER geo so normalize has the timezone from state.geoContext.
  //    normalize (scalar canonicalization + local time) → classify (eventType/tiers)
  .embeddedDAG<CartographerState, CartographerState>('canonicalize', 'canonicalize', {
    'success': 'route-kind',
    'error':   'rejected',
  }, {
    'inputs': {
      'raw':        'raw',
      'geoContext': 'geoContext',
    },
    'outputs': {
      'normalized':   'normalized',
      'currentEvent': 'currentEvent',
    },
  })

  // 4. route-kind: per-kind enrichment dispatch (skip irrelevant work).
  .node('route-kind', routeKind, {
    'geo-only': 'enrich-leg',
    'sensor':   'cold-chain-check',
    'order':    'order-enrichment',
    'customs':  'customs-dwell',
  })

  // 4a. cold-chain-check (sensor lane): temp/shock breach evaluation.
  .node('cold-chain-check', coldChainCheck, {
    'checked': 'enrich-leg',
  })

  // 4b. customs-dwell (customs lane): clearance dwell hours.
  .node('customs-dwell', customsDwell, {
    'dwelled': 'enrich-leg',
  })

  // 4c. order-enrichment (order lane): embedded sub-DAG for value enrichment:
  //     enrich-pricing → enrich-shipping → enrich-eta.
  .embeddedDAG<CartographerState, CartographerState>('order-enrichment', 'order-enrichment', {
    'success': 'enrich-leg',
    'error':   'enrich-leg',
  }, {
    'inputs': {
      'normalized': 'normalized',
    },
    'outputs': {
      'pricedOrder':       'pricedOrder',
      'shippingQuote':     'shippingQuote',
      'deliveryEstimate':  'deliveryEstimate',
    },
  })

  // 5. enrich-leg: legFrom → scan distance (every lane converges here).
  .node('enrich-leg', enrichLeg, {
    'leg-measured': 'route-redaction',
  })

  // 6. route-redaction: SKIP the redaction sub-DAG when not required.
  //    skip-redaction routes directly to aggregate-event (no intermediate node).
  .node('route-redaction', routeRedaction, {
    'needs-redaction': 'gdpr',
    'skip-redaction':  'aggregate-event',
  })

  // 6a. gdpr (run path): embedded gdpr-compliance sub-DAG.
  .embeddedDAG('gdpr', 'gdpr-compliance', {
    'success': 'aggregate-event',
    'error':   'gdpr-violation',
  }, {
    'outputs': {
      'currentEvent': 'currentEvent',
      'gdprResult':   'gdprResult',
    },
  })

  // 7. aggregate-event: write compact EnrichedShipment to state.enriched.
  .node('aggregate-event', aggregateEvent, {
    'done': 'done',
  })

  // Terminals
  .terminal('done',           { outcome: 'completed' })
  .terminal('rejected',       { outcome: 'failed' })
  .terminal('gdpr-violation', { outcome: 'failed' })

  .build();
// #endregion event-pipeline-dag

// ── DAG 1b: cartographer-workers (container variant) ─────────────────────────

// #region cartographer-workers-dag
/**
 * cartographerWorkersDAG: the same top-level orchestration as cartographerDAG
 * with one difference — the `process-events` scatter binds `container: 'cpu'`
 * so each canonical-event enrichment body runs inside a WorkerThreadContainer
 * instead of in-process. The ingestion fan-in (ingest-sources scatter) still
 * runs in-process; only the CPU-bound enrichment is offloaded.
 *
 * Used by runCartographer.ts when launched with `--workers` (or CARTO_WORKERS=1).
 * The companion registry module (workers/eventPipelineRegistry.ts, compiled to
 * workers/eventPipelineRegistry.js) reconstructs the event-pipeline bundle
 * inside each worker thread.
 */
export const cartographerWorkersDAG: DAG = new DAGBuilder('cartographer', '1.0')

  .phase('seed', 'pre', seedEvents)

  .scatter(
    'ingest-sources',
    'sources',
    { 'dag': 'ingest-source' },
    {
      'all-success': 'merge-events',
      'partial':     'merge-events',
      'all-error':   'merge-events',
      'empty':       'merge-events',
    },
    {
      'itemKey':     'source',
      'concurrency': 4,
      'gather': {
        'strategy': 'append',
        'field':    'ingestedEvents',
        'target':   'ingestBuckets',
      },
    },
  )

  .node('merge-events', mergeEvents, {
    'merged': 'process-events',
  })

  // Streaming enrichment — container: 'cpu' routes each event's enrichment
  // body to a WorkerThreadContainer (real worker threads) instead of in-process.
  .scatter(
    'process-events',
    'canonicalEvents',
    { 'dag': 'event-pipeline' },
    {
      'all-success': 'summarize',
      'partial':     'summarize',
      'all-error':   'summarize',
      'empty':       'summarize',
    },
    {
      'itemKey':     'canonical-event',
      'concurrency': 16,
      'container':   'cpu',
      'gather': {
        'strategy': 'append',
        'field':    'enriched',
        'target':   'records',
      },
    },
  )

  .node('summarize', summarizeInsights, {
    'success': 'done',
  })

  .terminal('done', { outcome: 'completed' })

  .build();
// #endregion cartographer-workers-dag

// ── Bundle registration ───────────────────────────────────────────────────────

// #region dispatcher-bundle
/**
 * Top-level bundle. Register AFTER all embedded sub-DAG bundles so the
 * dispatcher can resolve 'geo-resolve', 'canonicalize', 'order-enrichment',
 * 'gdpr-compliance', and 'ingest-source' references.
 */
export const cartographerBundle: DispatcherBundle<CartographerState, CartographerServices> = {
  'nodes': [
    seedEvents,
    mergeEvents,
    parseEvent,
    routeGeo,
    applyGeo,
    validateCoords,
    routeKind,
    coldChainCheck,
    customsDwell,
    enrichLeg,
    routeRedaction,
    aggregateEvent,
    summarizeInsights,
  ],
  'dags': [eventPipelineDAG, cartographerDAG],
};

/**
 * cartographerWorkersBundle: same nodes as cartographerBundle, but the DAG is
 * cartographerWorkersDAG (which binds container: 'cpu' on process-events).
 * Used by runCartographer.ts when `--workers` is active.
 */
export const cartographerWorkersBundle: DispatcherBundle<CartographerState, CartographerServices> = {
  'nodes': [
    seedEvents,
    mergeEvents,
    parseEvent,
    routeGeo,
    applyGeo,
    validateCoords,
    routeKind,
    coldChainCheck,
    customsDwell,
    enrichLeg,
    routeRedaction,
    aggregateEvent,
    summarizeInsights,
  ],
  'dags': [eventPipelineDAG, cartographerWorkersDAG],
};
// #endregion dispatcher-bundle
