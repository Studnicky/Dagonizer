/**
 * The Cartographer: DAGs proving data orchestration = the same engine, on a
 * multi-source ingestion fan-in + a streaming enrichment scatter.
 *
 * 1. cartographer (top-level):
 *    seed (pre-phase: build the multi-format source feeds)
 *      → scatter('ingest-sources', 'sources', { dag: 'ingest-source' },
 *                gather: append ingestedEvents → canonicalEvents)   [THE FAN-IN]
 *      → scatter('process-events', 'canonicalEvents', { dag: 'event-pipeline-typed' },
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
 * 3. event-pipeline-typed (enrichment scatter body, one run per canonical event):
 *    route-event-type-variant → {position-ping|sensor-reading|customs-event|
 *      facility-scan|delivery-confirmation}
 *    Each branch is a per-type embedded DAG that starts with parse-variant,
 *    embeds geo-pipeline, runs type-specific enrichment, and converges on
 *    aggregate-event → done.
 */

// #region cartographer-dag-imports
import { routeGeo }          from './nodes/routeGeo.ts';
import { applyGeo }          from './nodes/applyGeo.ts';
import { validateCoords }    from './nodes/validateCoords.ts';
import { coldChainCheck }    from './nodes/coldChainCheck.ts';
import { customsDwell }      from './nodes/customsDwell.ts';
import { enrichLeg }         from './nodes/enrichLeg.ts';
import { routeRedaction }    from './nodes/routeRedaction.ts';
import { aggregateEvent }    from './nodes/aggregateEvent.ts';
import { mergeEvents }       from './nodes/mergeEvents.ts';
import { summarizeInsights } from './nodes/summarizeInsights.ts';
import { seedEvents }        from './nodes/seedEvents.ts';
import { classifyBatch }     from './nodes/classifyBatch.ts';
import { routeEventType }    from './nodes/routeEventType.ts';
import { parseVariant }      from './nodes/parseVariant.ts';
import { canonicalizeCore }  from './nodes/canonicalizeCore.ts';
import { canonicalizeFacility }  from './nodes/canonicalizeFacility.ts';
import { canonicalizeRecipient } from './nodes/canonicalizeRecipient.ts';
import { confirmDelivery }   from './nodes/confirmDelivery.ts';

import { reverseGeocode }  from './nodes/geo/reverseGeocode.ts';
import { routeModalities } from './nodes/geo/routeModalities.ts';
import { ipGeolocate }     from './nodes/geo/ipGeolocate.ts';
import { fuseGeo }         from './nodes/geo/fuseGeo.ts';
import { enrichPricing }   from './nodes/enrichPricing.ts';
import { enrichShipping }  from './nodes/enrichShipping.ts';
import { enrichEta }       from './nodes/enrichEta.ts';
import { consentGate, classifyPii, redactPii } from './nodes/gdprNodes.ts';

import { geoResolveDAG }      from './embedded-dags/GeoResolveDAG.ts';
import { geoPipelineDAG }     from './embedded-dags/GeoPipelineDAG.ts';
import { orderEnrichmentDAG } from './embedded-dags/OrderEnrichmentDAG.ts';
import { gdprComplianceDAG }  from './embedded-dags/GdprComplianceDAG.ts';
import { pipelinePositionPingDAG }        from './embedded-dags/PipelinePositionPingDAG.ts';
import { pipelineSensorReadingDAG }       from './embedded-dags/PipelineSensorReadingDAG.ts';
import { pipelineCustomsEventDAG }        from './embedded-dags/PipelineCustomsEventDAG.ts';
import { pipelineFacilityScanDAG }        from './embedded-dags/PipelineFacilityScanDAG.ts';
import { pipelineDeliveryConfirmationDAG } from './embedded-dags/PipelineDeliveryConfirmationDAG.ts';

import type { CartographerState } from './CartographerState.ts';
import type { CartographerServices } from './CartographerServices.ts';

import type { DAG, DispatcherBundle } from '@noocodex/dagonizer';
import { DAGBuilder } from '@noocodex/dagonizer';
// #endregion cartographer-dag-imports

// ── DAG 1: cartographer (top-level) ─────────────────────────────────────────

// #region cartographer-dag
export const cartographerDAG: DAG = new DAGBuilder('cartographer', '1.0')

  // Pre-phase: seeds state.sources = Sources.buildTypedFeed(state.eventConfig) — the
  // per-type source feeds — before the ingestion scatter reads them.
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
    'merged': 'batch-by-event-type',
  })

  // Reservoir scatter (DEMO): batch canonical events by event type before enrichment.
  // Uses a keyed reservoir (keyField: 'eventType') so the engine groups events by
  // their canonical event type and releases a same-event-type batch when capacity=50
  // is reached or 100 ms of idle elapses. The body (classifyBatch) is a
  // pass-through that records the batch size for observability and routes
  // all items to 'classified'. gather: discard — no clone state flows back;
  // the original canonicalEvents array is untouched for process-events.
  .scatter<CartographerState, 'classified', CartographerServices>(
    'batch-by-event-type',
    'canonicalEvents',
    classifyBatch,
    {
      'all-success': 'process-events',
      'partial':     'process-events',
      'all-error':   'process-events',
      'empty':       'process-events',
    },
    {
      'itemKey': 'canonical-event',
      'gather': { 'strategy': 'discard' },
      'reservoir': { 'keyField': 'eventType', 'capacity': 50, 'idleMs': 100 },
    },
  )

  // Streaming enrichment: scatter over the merged canonical events at
  // concurrency 16. Each clone's state.enriched is appended into state.records.
  // Uses event-pipeline-typed: each event routes through its per-type sub-DAG.
  .scatter(
    'process-events',
    'canonicalEvents',
    { 'dag': 'event-pipeline-typed' },
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

// ── DAG 2: event-pipeline-typed (the LIVE scatter body, typed per-event-type paths) ──

// #region event-pipeline-typed-dag
/**
 * event-pipeline-typed: the live enrichment scatter body for process-events.
 *
 * Reads the scattered CanonicalEventVariant from metadata key 'canonical-event'
 * and routes it to one of five per-type embedded DAGs via route-event-type-variant.
 * Each per-type DAG starts with parse-variant (which also reads from metadata),
 * embeds geo-pipeline for geo resolution, runs type-specific enrichment nodes,
 * and converges on aggregate-event → done.
 *
 *   route-event-type-variant
 *     ├─position-ping──────────► pipeline-position-ping (embedded)
 *     ├─sensor-reading─────────► pipeline-sensor-reading (embedded)
 *     ├─customs-event──────────► pipeline-customs-event (embedded)
 *     ├─facility-scan──────────► pipeline-facility-scan (embedded)
 *     └─delivery-confirmation──► pipeline-delivery-confirmation (embedded)
 *   Each per-type DAG:
 *     parse-variant → geo-pipeline → canonicalize-core → [type-specific] → aggregate-event → done
 *
 * Metadata propagation: the scatter sets 'canonical-event' on each clone's
 * metadata. NodeStateBase.clone() copies _metadata, so metadata propagates
 * to embedded child clones. Both route-event-type-variant and parse-variant
 * read 'canonical-event' from metadata.
 */
export const eventPipelineTypedDAG: DAG = new DAGBuilder('event-pipeline-typed', '1.0')

  // 1. route-event-type-variant: read eventType from 'canonical-event' metadata
  //    and dispatch to the corresponding per-type sub-DAG.
  .node('route-event-type-variant', routeEventType, {
    'position-ping':         'pipeline-position-ping',
    'sensor-reading':        'pipeline-sensor-reading',
    'customs-event':         'pipeline-customs-event',
    'facility-scan':         'pipeline-facility-scan',
    'delivery-confirmation': 'pipeline-delivery-confirmation',
  })

  // 2a. pipeline-position-ping: geo + leg measurement.
  .embeddedDAG<CartographerState, CartographerState>('pipeline-position-ping', 'pipeline-position-ping', {
    'success': 'done',
    'error':   'rejected',
  }, {
    'outputs': {
      'canonicalVariant': 'canonicalVariant',
      'raw':              'raw',
      'normalized':       'normalized',
      'currentEvent':     'currentEvent',
      'geoContext':       'geoContext',
      'resolvedGeo':      'resolvedGeo',
      'legKm':            'legKm',
      'routing':          'routing',
      'enriched':         'enriched',
    },
  })

  // 2b. pipeline-sensor-reading: geo + cold-chain + leg measurement.
  .embeddedDAG<CartographerState, CartographerState>('pipeline-sensor-reading', 'pipeline-sensor-reading', {
    'success': 'done',
    'error':   'rejected',
  }, {
    'outputs': {
      'canonicalVariant': 'canonicalVariant',
      'raw':              'raw',
      'normalized':       'normalized',
      'currentEvent':     'currentEvent',
      'geoContext':       'geoContext',
      'resolvedGeo':      'resolvedGeo',
      'coldChainBreach':  'coldChainBreach',
      'legKm':            'legKm',
      'routing':          'routing',
      'enriched':         'enriched',
    },
  })

  // 2c. pipeline-customs-event: geo + customs-dwell + leg measurement.
  .embeddedDAG<CartographerState, CartographerState>('pipeline-customs-event', 'pipeline-customs-event', {
    'success': 'done',
    'error':   'rejected',
  }, {
    'outputs': {
      'canonicalVariant':  'canonicalVariant',
      'raw':               'raw',
      'normalized':        'normalized',
      'currentEvent':      'currentEvent',
      'geoContext':        'geoContext',
      'resolvedGeo':       'resolvedGeo',
      'customsDwellHours': 'customsDwellHours',
      'legKm':             'legKm',
      'routing':           'routing',
      'enriched':          'enriched',
    },
  })

  // 2d. pipeline-facility-scan: geo + facility canonicalization + order enrichment
  //     + GDPR-gated redaction.
  .embeddedDAG<CartographerState, CartographerState>('pipeline-facility-scan', 'pipeline-facility-scan', {
    'success': 'done',
    'error':   'rejected',
  }, {
    'outputs': {
      'canonicalVariant':  'canonicalVariant',
      'raw':               'raw',
      'normalized':        'normalized',
      'currentEvent':      'currentEvent',
      'geoContext':        'geoContext',
      'resolvedGeo':       'resolvedGeo',
      'pricedOrder':       'pricedOrder',
      'shippingQuote':     'shippingQuote',
      'deliveryEstimate':  'deliveryEstimate',
      'legKm':             'legKm',
      'gdprResult':        'gdprResult',
      'routing':           'routing',
      'enriched':          'enriched',
    },
  })

  // 2e. pipeline-delivery-confirmation: geo + recipient canonicalization +
  //     delivery confirmation + GDPR-gated redaction.
  .embeddedDAG<CartographerState, CartographerState>('pipeline-delivery-confirmation', 'pipeline-delivery-confirmation', {
    'success': 'done',
    'error':   'rejected',
  }, {
    'outputs': {
      'canonicalVariant': 'canonicalVariant',
      'raw':              'raw',
      'normalized':       'normalized',
      'currentEvent':     'currentEvent',
      'geoContext':       'geoContext',
      'resolvedGeo':      'resolvedGeo',
      'legKm':            'legKm',
      'gdprResult':       'gdprResult',
      'routing':          'routing',
      'enriched':         'enriched',
    },
  })

  .terminal('done',     { outcome: 'completed' })
  .terminal('rejected', { outcome: 'failed' })

  .build();
// #endregion event-pipeline-typed-dag

// ── DAG 1b: cartographer-workers (container variant) ─────────────────────────

// #region cartographer-workers-dag
/**
 * cartographerWorkersDAG: the same top-level orchestration as cartographerDAG
 * with one difference — the `process-events` scatter binds `container: 'cpu'`
 * so each canonical-event enrichment body runs inside a WorkerThreadContainer
 * instead of in-process. The ingestion fan-in (ingest-sources scatter) still
 * runs in-process; only the CPU-bound enrichment is offloaded.
 *
 * Uses event-pipeline-typed for the per-type scatter body.
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
    'merged': 'batch-by-event-type',
  })

  .scatter<CartographerState, 'classified', CartographerServices>(
    'batch-by-event-type',
    'canonicalEvents',
    classifyBatch,
    {
      'all-success': 'process-events',
      'partial':     'process-events',
      'all-error':   'process-events',
      'empty':       'process-events',
    },
    {
      'itemKey': 'canonical-event',
      'gather': { 'strategy': 'discard' },
      'reservoir': { 'keyField': 'eventType', 'capacity': 50, 'idleMs': 100 },
    },
  )

  // Streaming enrichment — container: 'cpu' routes each event's enrichment
  // body to a WorkerThreadContainer (real worker threads) instead of in-process.
  // Uses event-pipeline-typed for the per-type scatter body.
  .scatter(
    'process-events',
    'canonicalEvents',
    { 'dag': 'event-pipeline-typed' },
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
 * eventPipelineBundle: complete bundle for the event-pipeline-typed scatter body.
 *
 * Registration order: leaf DAGs before DAGs that embed them.
 *   geo-resolve → geo-pipeline → order-enrichment → gdpr-compliance
 *   → 5 pipeline-* DAGs → event-pipeline-typed
 *
 * registerBundle is idempotent for same-instance nodes and DAGs (throws only
 * when a different instance with the same name is registered). Nodes shared
 * across per-type bundles (e.g. parseVariant, enrichLeg, aggregateEvent) appear
 * in multiple bundle.nodes arrays; since they are the same singleton instances,
 * repeated registration is a no-op.
 */
export const eventPipelineBundle: DispatcherBundle<CartographerState, CartographerServices> = {
  'nodes': [
    // geo-resolve leaf nodes
    reverseGeocode, routeModalities, ipGeolocate, fuseGeo,
    // geo-pipeline nodes
    routeGeo, applyGeo, validateCoords,
    // order-enrichment nodes
    enrichPricing, enrichShipping, enrichEta,
    // gdpr-compliance nodes
    consentGate, classifyPii, redactPii,
    // typed pipeline nodes shared across all per-type DAGs
    parseVariant, canonicalizeCore, enrichLeg, aggregateEvent,
    // facility-scan + delivery-confirmation specific
    canonicalizeFacility, canonicalizeRecipient, routeRedaction,
    // delivery-confirmation specific
    confirmDelivery,
    // cold-chain (sensor lane) + customs-dwell (customs lane)
    coldChainCheck, customsDwell,
    // top-level router for event-pipeline-typed
    routeEventType,
  ],
  'dags': [
    // Leaf embedded DAG first, then DAGs that embed it.
    geoResolveDAG,
    geoPipelineDAG,
    orderEnrichmentDAG,
    gdprComplianceDAG,
    // 5 per-type pipeline DAGs (each embeds geo-pipeline)
    pipelinePositionPingDAG,
    pipelineSensorReadingDAG,
    pipelineCustomsEventDAG,
    pipelineFacilityScanDAG,
    pipelineDeliveryConfirmationDAG,
    // Top-level typed scatter body
    eventPipelineTypedDAG,
  ],
};

/**
 * cartographerBundle: top-level bundle for the cartographer DAG.
 *
 * Extends eventPipelineBundle with the top-level cartographer-specific nodes
 * and the cartographerDAG itself. Register AFTER all embedded sub-DAG bundles.
 * The ingest-source DAG and its nodes are registered separately by IngestSourceDAG.ts.
 */
export const cartographerBundle: DispatcherBundle<CartographerState, CartographerServices> = {
  'nodes': [
    ...eventPipelineBundle.nodes,
    // Top-level cartographer nodes not in the event pipeline
    seedEvents,
    mergeEvents,
    classifyBatch,
    summarizeInsights,
  ],
  'dags': [
    ...eventPipelineBundle.dags,
    // The top-level DAG registered last
    cartographerDAG,
  ],
};

/**
 * cartographerWorkersBundle: same nodes as cartographerBundle, but the DAG is
 * cartographerWorkersDAG (which binds container: 'cpu' on process-events).
 * Used by runCartographer.ts when `--workers` is active.
 */
export const cartographerWorkersBundle: DispatcherBundle<CartographerState, CartographerServices> = {
  'nodes': [
    ...eventPipelineBundle.nodes,
    seedEvents,
    mergeEvents,
    classifyBatch,
    summarizeInsights,
  ],
  'dags': [
    ...eventPipelineBundle.dags,
    cartographerWorkersDAG,
  ],
};
// #endregion dispatcher-bundle
