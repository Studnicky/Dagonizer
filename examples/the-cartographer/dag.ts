/**
 * The Cartographer: DAGs proving data orchestration = the same engine, on a
 * single streaming scatter over raw source payloads.
 *
 * 1. cartographer (top-level):
 *    seed (pre-phase: build or stream the source feeds into state.sources)
 *      → scatter('process-stream', 'sources', { dag: 'stream-event' },
 *                gather: insights-fold)                             [STREAMING]
 *      → summarize → done
 *
 *    The insights-fold gather folds each clone's state.enriched into three bounded
 *    accumulators (state.insights, state.journeys, state.sampleRecords) as clones
 *    complete. Memory is O(1) regardless of event count.
 *
 * 2. stream-event (streaming scatter body, one run per source payload):
 *    decode-payload → route-event-type-variant → per-type embedded DAG → done/rejected
 *    (see embedded-dags/StreamEventDAG.ts)
 *
 * 3. event-pipeline-typed (retained for dag-validate.ts and direct consumers):
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
import { summarizeInsights } from './nodes/summarizeInsights.ts';
import { seedEvents }        from './nodes/seedEvents.ts';
import { routeEventType }    from './nodes/routeEventType.ts';
import { parseVariant }      from './nodes/parseVariant.ts';
import { canonicalizeCore }  from './nodes/canonicalizeCore.ts';
import { canonicalizeFacility }  from './nodes/canonicalizeFacility.ts';
import { canonicalizeRecipient } from './nodes/canonicalizeRecipient.ts';
import { confirmDelivery }   from './nodes/confirmDelivery.ts';
import { decodePayload }     from './nodes/decodePayload.ts';

import { enrichPricing }   from './nodes/enrichPricing.ts';
import { enrichShipping }  from './nodes/enrichShipping.ts';
import { enrichEta }       from './nodes/enrichEta.ts';
import { consentGate, classifyPii, redactPii } from './nodes/gdprNodes.ts';

import { geoPipelineDAG }     from './embedded-dags/GeoPipelineDAG.ts';
import { orderEnrichmentDAG } from './embedded-dags/OrderEnrichmentDAG.ts';
import { gdprComplianceDAG }  from './embedded-dags/GdprComplianceDAG.ts';
import { pipelinePositionPingDAG }        from './embedded-dags/PipelinePositionPingDAG.ts';
import { pipelineSensorReadingDAG }       from './embedded-dags/PipelineSensorReadingDAG.ts';
import { pipelineCustomsEventDAG }        from './embedded-dags/PipelineCustomsEventDAG.ts';
import { pipelineFacilityScanDAG }        from './embedded-dags/PipelineFacilityScanDAG.ts';
import { pipelineDeliveryConfirmationDAG } from './embedded-dags/PipelineDeliveryConfirmationDAG.ts';
import { streamEventDAG } from './embedded-dags/StreamEventDAG.ts';

import type { CartographerState } from './CartographerState.ts';

import type { DAGType, DispatcherBundleType } from '@studnicky/dagonizer';
import { DAGBuilder } from '@studnicky/dagonizer';

import './core/InsightsFoldGather.ts';
// #endregion cartographer-dag-imports

// ── DAG 1: cartographer (top-level) ─────────────────────────────────────────

// #region cartographer-dag
/**
 * cartographerDAG: single streaming scatter over raw source payloads.
 *
 * The pre-phase seeds state.sources with an AsyncIterable<SourcePayload>
 * (streaming path) or a materialised SourcePayload[] (array path). The
 * scatter reads either form transparently at concurrency 16, running the
 * stream-event DAG per item. Each stream-event body decodes the payload,
 * routes to the per-type pipeline DAG, and produces state.enriched. The
 * insights-fold gather accumulates state.insights (exact region rollup),
 * state.journeys (bounded journey sample), and state.sampleRecords (capped
 * FIFO of scans) into the parent as each clone completes. Memory is O(1)
 * regardless of event count.
 *
 * Topology:
 *   seed (pre)
 *     → scatter('process-stream', 'sources', { dag: 'stream-event' },
 *               gather: { strategy: 'insights-fold' }, concurrency: 16)
 *     → summarize → done
 */
export const cartographerDAG: DAGType = new DAGBuilder('cartographer', '1.0')

  // Pre-phase: seeds state.sources before the scatter reads it. When
  // state.useStreamingSource is true, sources is an AsyncIterable<SourcePayload>;
  // otherwise a materialised SourcePayload[].
  .phase('seed', 'pre', seedEvents)

  // Single streaming scatter over state.sources. Each item is a SourcePayload
  // placed on metadata key 'source-payload'; the stream-event body decodes it
  // and routes to the matching per-type pipeline DAG. The insights-fold gather
  // folds each clone's state.enriched into the parent's bounded accumulators.
  .scatter(
    'process-stream',
    'sources',
    { 'dag': 'stream-event' },
    {
      'all-success': 'summarize',
      'partial':     'summarize',
      'all-error':   'summarize',
      'empty':       'summarize',
    },
    {
      'itemKey':     'source-payload',
      'concurrency': 16,
      'gather': { 'strategy': 'insights-fold' },
      'reservoir': { 'keyField': 'eventType', 'capacity': 1000 },
    },
  )

  // Pass-through in the streaming path (insights-fold already populated
  // state.insights, state.journeys, and state.sampleRecords). Falls back
  // to the records-based fold for non-streaming callers.
  .node('summarize', summarizeInsights, {
    'success': 'done',
  })

  .terminal('done', { outcome: 'completed' })

  .build();
// #endregion cartographer-dag

// ── DAG 1a: cartographer-resume (streaming resume variant, no reservoir) ─────

// #region cartographer-resume-dag
/**
 * cartographerResumeDAG: streaming-resume variant of cartographerDAG.
 *
 * Identical topology but WITHOUT reservoir on process-stream.
 * Per-item dispatch (ScatterWorkerPool path) allows the run-level abort signal
 * to fire between item pulls, giving a non-zero StreamCursor.resumeAfter(state,
 * 'process-stream') value on abort. Used by CartographerResumableScenario only.
 *
 * Topology (same as cartographerDAG):
 *   seed (pre)
 *     → scatter('process-stream', 'sources', { dag: 'stream-event' },
 *               gather: { strategy: 'insights-fold' }, concurrency: 16)
 *     → summarize → done
 */
export const cartographerResumeDAG: DAGType = new DAGBuilder('cartographer-resume', '1.0')

  .phase('seed', 'pre', seedEvents)

  .scatter(
    'process-stream',
    'sources',
    { 'dag': 'stream-event' },
    {
      'all-success': 'summarize',
      'partial':     'summarize',
      'all-error':   'summarize',
      'empty':       'summarize',
    },
    {
      'itemKey':     'source-payload',
      'concurrency': 16,
      'gather': { 'strategy': 'insights-fold' },
    },
  )

  .node('summarize', summarizeInsights, {
    'success': 'done',
  })

  .terminal('done', { outcome: 'completed' })

  .build();
// #endregion cartographer-resume-dag

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
export const eventPipelineTypedDAG: DAGType = new DAGBuilder('event-pipeline-typed', '1.0')

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
      'capturedErrors':   'capturedErrors',
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
      'capturedErrors':   'capturedErrors',
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
      'capturedErrors':   'capturedErrors',
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
      'capturedErrors':   'capturedErrors',
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
      'capturedErrors':   'capturedErrors',
    },
  })

  .terminal('done',     { outcome: 'completed' })
  .terminal('rejected', { outcome: 'failed' })

  .build();
// #endregion event-pipeline-typed-dag

// ── DAG 1b: cartographer-workers (container variant) ─────────────────────────

// #region cartographer-workers-dag
/** Default reservoir capacity for the process-stream scatter in the workers DAG. */
export const DEFAULT_RESERVOIR_CAPACITY = 1000;

/**
 * CartographerWorkersDag: static factory for the cartographer-workers DAG and
 * its associated dispatcher bundle. Consumers call CartographerWorkersDag.build()
 * (DAG only) or CartographerWorkersDag.bundle() (full dispatcher bundle) with an
 * optional reservoir capacity override.
 *
 * DAG topology — identical to cartographerDAG with two differences:
 *   - container: 'cpu' so each stream-event body runs inside a
 *     WorkerThreadContainer (real worker threads) rather than in-process.
 *   - reservoir.capacity is parameterised; callers pass their UI-controlled
 *     batch size rather than relying on the compile-time default.
 *
 *   seed (pre)
 *     → scatter('process-stream', 'sources', { dag: 'stream-event' },
 *               gather: { strategy: 'insights-fold' }, concurrency: 16,
 *               container: 'cpu', reservoir: { capacity })
 *     → summarize → done
 */
export class CartographerWorkersDag {
  private constructor() { /* static-only */ }

  /**
   * Build the cartographer-workers DAG with the given reservoir capacity.
   * CLI, smoke tests, and dag-validate consumers use cartographerWorkersDAG
   * (the pre-built constant); the browser demo calls this with a UI-controlled value.
   */
  static build(capacity: number = DEFAULT_RESERVOIR_CAPACITY): DAGType {
    return new DAGBuilder('cartographer', '1.0')

      .phase('seed', 'pre', seedEvents)

      .scatter(
        'process-stream',
        'sources',
        { 'dag': 'stream-event' },
        {
          'all-success': 'summarize',
          'partial':     'summarize',
          'all-error':   'summarize',
          'empty':       'summarize',
        },
        {
          'itemKey':     'source-payload',
          'concurrency': 16,
          'container':   'cpu',
          'gather': { 'strategy': 'insights-fold' },
          'reservoir': { 'keyField': 'eventType', 'capacity': capacity },
        },
      )

      .node('summarize', summarizeInsights, {
        'success': 'done',
      })

      .terminal('done', { outcome: 'completed' })

      .build();
  }

  /**
   * Build the workers bundle with a configurable reservoir capacity. The returned
   * bundle is identical to cartographerWorkersBundle except that its cartographer
   * DAG is built with CartographerWorkersDag.build(capacity) so the process-stream
   * scatter uses the caller-supplied batch size.
   *
   * Used by the browser demo to wire UI-controlled knobs into each run() without
   * mutating the shared default-capacity constants.
   */
  static bundle(
    capacity: number = DEFAULT_RESERVOIR_CAPACITY,
  ): DispatcherBundleType<CartographerState> {
    return {
      'nodes': [
        ...eventPipelineBundle.nodes,
        seedEvents,
        summarizeInsights,
      ],
      'dags': [
        ...eventPipelineBundle.dags,
        CartographerWorkersDag.build(capacity),
      ],
    };
  }
}

/**
 * cartographerWorkersDAG: pre-built workers DAG at DEFAULT_RESERVOIR_CAPACITY.
 * CLI, smoke tests, and dag-validate consumers use this constant; the browser
 * demo uses CartographerWorkersDag.build(capacity) with a UI-controlled value.
 */
export const cartographerWorkersDAG: DAGType = CartographerWorkersDag.build();
// #endregion cartographer-workers-dag

// ── Bundle registration ───────────────────────────────────────────────────────

// #region dispatcher-bundle
/**
 * eventPipelineBundle: complete bundle for the stream-event scatter body. It is
 * self-contained — a worker registry that registers it can run the whole
 * stream-event sub-tree (decode → route → 5 per-type pipelines).
 *
 * Registration order: leaf DAGs before DAGs that embed them.
 *   geo-source-resolve → geo-pipeline → order-enrichment → gdpr-compliance
 *   → 5 pipeline-* DAGs → event-pipeline-typed → stream-event
 *
 * registerBundle is idempotent for same-instance nodes and DAGs (throws only
 * when a different instance with the same name is registered). Nodes shared
 * across per-type bundles (e.g. parseVariant, enrichLeg, aggregateEvent) appear
 * in multiple bundle.nodes arrays; since they are the same singleton instances,
 * repeated registration is a no-op.
 */
export const eventPipelineBundle: DispatcherBundleType<CartographerState> = {
  'nodes': [
    // geo-source-resolve nodes are registered per-call via GeoSourceResolveDAG.build()
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
    // stream-event body: decode-payload + the event-type router
    decodePayload, routeEventType,
  ],
  'dags': [
    // Leaf embedded DAG first, then DAGs that embed it.
    // geo-source-resolve DAG is built per-call via GeoSourceResolveDAG.build() — registered at call site.
    geoPipelineDAG,
    orderEnrichmentDAG,
    gdprComplianceDAG,
    // 5 per-type pipeline DAGs (each embeds geo-pipeline)
    pipelinePositionPingDAG,
    pipelineSensorReadingDAG,
    pipelineCustomsEventDAG,
    pipelineFacilityScanDAG,
    pipelineDeliveryConfirmationDAG,
    // Typed scatter bodies: event-pipeline-typed (pre-decoded) and stream-event
    // (decode-inline). stream-event is the live container scatter body.
    eventPipelineTypedDAG,
    streamEventDAG,
  ],
};

/**
 * cartographerBundle: top-level bundle for the cartographer DAG.
 *
 * Registration order for the streaming topology:
 *   leaf DAGs (geo-resolve, geo-pipeline, order-enrichment, gdpr-compliance)
 *   → 5 per-type pipeline DAGs
 *   → event-pipeline-typed (embeds the 5 pipeline DAGs)
 *   → stream-event (embeds the 5 pipeline DAGs, reuses routeEventType + decodePayload)
 *   → cartographerDAG (embeds stream-event)
 *
 * The ingest-source DAG and its nodes are registered separately by IngestSourceDAG.ts.
 * routeEventType appearing in both eventPipelineBundle.nodes and streamEventBundle.nodes
 * is safe: the bundle registrar is idempotent for same-instance re-registration.
 */
export const cartographerBundle: DispatcherBundleType<CartographerState> = {
  'nodes': [
    ...eventPipelineBundle.nodes,
    // Top-level cartographer nodes
    seedEvents,
    summarizeInsights,
  ],
  'dags': [
    // eventPipelineBundle already registers stream-event and its sub-tree;
    // cartographerDAG embeds stream-event, so it comes last.
    ...eventPipelineBundle.dags,
    cartographerDAG,
  ],
};

/**
 * cartographerWorkersBundle: identical to cartographerBundle but uses
 * cartographerWorkersDAG, which binds container: 'cpu' on the process-stream
 * scatter. Used by runCartographer.ts when --workers is active.
 */
export const cartographerWorkersBundle: DispatcherBundleType<CartographerState> = CartographerWorkersDag.bundle();

/**
 * cartographerResumeBundle: streaming-resume scenario bundle.
 *
 * Uses cartographerResumeDAG (no reservoir on process-stream) so the pull loop
 * interleaves with item execution, giving a non-zero abort cursor.
 * Used exclusively by CartographerResumableScenario in runCartographer.ts.
 */
export const cartographerResumeBundle: DispatcherBundleType<CartographerState> = {
  'nodes': [...cartographerBundle.nodes],
  'dags': [
    ...eventPipelineBundle.dags,
    cartographerResumeDAG,
  ],
};
// #endregion dispatcher-bundle
