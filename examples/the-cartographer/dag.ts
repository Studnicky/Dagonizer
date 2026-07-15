/**
 * The Cartographer: DAGs proving data orchestration = the same engine, on
 * source-specific feed DAGs and a first-class open gather.
 *
 * 1. cartographer (top-level):
 *    {position-ping|facility-scan|sensor-reading|customs-event|
 *     delivery-confirmation} entrypoints
 *      → per-producer dag-feed-* embedded DAGs
 *      → gather('intake-gather', strategy: canonical-feed)
 *      → scatter('process-stream', 'canonicalEvents', { dag: 'event-pipeline-typed' })
 *      → gather('fold-insights', strategy: insights-fold)
 *      → summarize → done
 *
 *    The browser workers variant delegates process-stream to container role
 *    "cpu" and delegates the summary embedded DAG to container role "io".
 *
 *    The insights-fold gather folds each clone's state.enriched into three
 *    bounded accumulators (state.insights, state.journeys, state.sampleRecords)
 *    as clones complete.
 *
 * 2. producer feed DAGs (one per source):
 *    feed-* → unpack-normalize (ingest-source) → collect-normalized
 *      → merge-events → done
 *
 * 3. event-pipeline-typed (the shared post-feed enrichment body):
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
import { routeEventType }    from './nodes/routeEventType.ts';
import { parseVariant }      from './nodes/parseVariant.ts';
import { canonicalizeCore }  from './nodes/canonicalizeCore.ts';
import { canonicalizeFacility }  from './nodes/canonicalizeFacility.ts';
import { canonicalizeRecipient } from './nodes/canonicalizeRecipient.ts';
import { confirmDelivery }   from './nodes/confirmDelivery.ts';
import { decodePayload }     from './nodes/decodePayload.ts';
import { CARTOGRAPHER_IRIS } from './cartographerIds.ts';

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
import { producerFeedBundle } from './embedded-dags/ProducerFeedDAG.ts';

import type { CartographerState } from './CartographerState.ts';

import type { DAGType, DispatcherBundleType } from '@studnicky/dagonizer';
import { DAGBuilder } from '@studnicky/dagonizer';

import './core/SourceIntakeGather.ts';
import './core/InsightsFoldGather.ts';
import './core/CanonicalFeedGather.ts';
// #endregion cartographer-dag-imports

const CARTOGRAPHER_DAG_IRI = CARTOGRAPHER_IRIS.dag.cartographer;
const CARTOGRAPHER_RESUME_DAG_IRI = CARTOGRAPHER_IRIS.dag.cartographerResume;
const INSIGHTS_SUMMARY_DAG_IRI = CARTOGRAPHER_IRIS.dag.insightsSummary;
const EVENT_PIPELINE_TYPED_DAG_IRI = CARTOGRAPHER_IRIS.dag.eventPipelineTyped;

function appendProducerFeedEntrypoints(builder: DAGBuilder, dagIri: string): DAGBuilder {
  const intakeGatherIri = CARTOGRAPHER_IRIS.placementIri(dagIri, 'intake-gather');
  for (const eventType of CARTOGRAPHER_IRIS.intakeEventTypes) {
    builder.embed<CartographerState, CartographerState>(
      CARTOGRAPHER_IRIS.feedPlacementIri(dagIri, eventType),
      CARTOGRAPHER_IRIS.feedDagIri(eventType),
      {
        'success': intakeGatherIri,
        'error':   intakeGatherIri,
      },
    );
  }
  return builder;
}

function appendCanonicalFeedGather(builder: DAGBuilder, dagIri: string, emptyTarget: string): DAGBuilder {
  return builder.gather(
    CARTOGRAPHER_IRIS.placementIri(dagIri, 'intake-gather'),
    CARTOGRAPHER_IRIS.feedSources(dagIri),
    { 'strategy': 'canonical-feed' },
    {
      'success': CARTOGRAPHER_IRIS.placementIri(dagIri, 'process-stream'),
      'error':   CARTOGRAPHER_IRIS.placementIri(dagIri, 'process-stream'),
      'empty':   emptyTarget,
    },
  );
}

// ── DAG 1: cartographer (top-level) ─────────────────────────────────────────

// #region cartographer-dag
/**
 * cartographerDAG: source-specific producer feed DAGs into one open gather.
 *
 * Five entrypoints target five producer feed DAG placements. Each feed DAG opens
 * one producer's source stream, scatters payloads through ingest-source for
 * unpack/normalize/validate, merges the producer's canonical events, and returns
 * them to the top-level canonical-feed gather. The processing scatter reads the
 * gathered canonicalEvents collection at concurrency 16, runs the shared typed
 * event pipeline, and folds completed clone state through insights-fold.
 *
 * Topology:
 *   5 data-type entrypoints → 5 dag-feed-* embedded DAGs
 *     → gather('intake-gather', canonical-feed)
 *     → scatter('process-stream', 'canonicalEvents', { dag: 'event-pipeline-typed' }, concurrency: 16)
 *     → gather('fold-insights', strategy: insights-fold)
 *     → summarize → done
 */
export const cartographerDAG: DAGType = appendCanonicalFeedGather(
  appendProducerFeedEntrypoints(new DAGBuilder(CARTOGRAPHER_DAG_IRI, '1.0'), CARTOGRAPHER_DAG_IRI),
  CARTOGRAPHER_DAG_IRI,
  CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'done'),
)

  .scatter(
    CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'process-stream'),
    'canonicalEvents',
    { 'dag': EVENT_PIPELINE_TYPED_DAG_IRI },
    {
      'all-success': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'fold-insights'),
      'partial':     CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'fold-insights'),
      'all-error':   CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'fold-insights'),
      'empty':       CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'summarize'),
    },
    {
      'itemKey':     'canonical-event',
      'execution': { 'mode': 'reservoir', 'concurrency': 16, 'reservoir': { 'keyField': 'eventType', 'capacity': 1000 } },
    },
  )
  .gather(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'fold-insights'), {
    [CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'process-stream')]: {},
  }, { 'strategy': 'insights-fold' }, {
    'success': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'summarize'),
    'error':   CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'summarize'),
    'empty':   CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'summarize'),
  })

  // Pass-through in the streaming path (insights-fold already populated
  // state.insights, state.journeys, and state.sampleRecords). Falls back
  // to the records-based fold for non-streaming callers.
  .node(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'summarize'), summarizeInsights, {
    'success': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'done'),
  })

  .terminal(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'done'), { outcome: 'completed' })

  .entrypoints(CARTOGRAPHER_IRIS.feedEntrypoints(CARTOGRAPHER_DAG_IRI))

  .build();
// #endregion cartographer-dag

// ── DAG 1a: cartographer-resume (streaming resume variant, no reservoir) ─────

// #region cartographer-resume-dag
/**
 * cartographerResumeDAG: streaming-resume variant of cartographerDAG.
 *
 * Same feed topology as cartographerDAG but WITHOUT reservoir on process-stream.
 * Per-item dispatch lets the run-level abort signal fire between canonical
 * event pulls, giving a non-zero StreamCursor.resumeAfter(state,
 * 'process-stream') value on abort. Used by CartographerResumableScenario only.
 *
 * Topology (same as cartographerDAG):
 *   5 data-type entrypoints → 5 dag-feed-* embedded DAGs
 *     → gather('intake-gather', canonical-feed)
 *     → scatter('process-stream', 'canonicalEvents', { dag: 'event-pipeline-typed' }, concurrency: 16)
 *     → gather('fold-insights', strategy: insights-fold)
 *     → summarize → done
 */
export const cartographerResumeDAG: DAGType = appendCanonicalFeedGather(
  appendProducerFeedEntrypoints(new DAGBuilder(CARTOGRAPHER_RESUME_DAG_IRI, '1.0'), CARTOGRAPHER_RESUME_DAG_IRI),
  CARTOGRAPHER_RESUME_DAG_IRI,
  CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_RESUME_DAG_IRI, 'done'),
)

  .scatter(
    CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_RESUME_DAG_IRI, 'process-stream'),
    'canonicalEvents',
    { 'dag': EVENT_PIPELINE_TYPED_DAG_IRI },
    {
      'all-success': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_RESUME_DAG_IRI, 'fold-insights'),
      'partial':     CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_RESUME_DAG_IRI, 'fold-insights'),
      'all-error':   CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_RESUME_DAG_IRI, 'fold-insights'),
      'empty':       CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_RESUME_DAG_IRI, 'summarize'),
    },
    {
      'itemKey':     'canonical-event',
      'execution': { 'mode': 'item', 'concurrency': 16 },
    },
  )
  .gather(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_RESUME_DAG_IRI, 'fold-insights'), {
    [CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_RESUME_DAG_IRI, 'process-stream')]: {},
  }, { 'strategy': 'insights-fold' }, {
    'success': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_RESUME_DAG_IRI, 'summarize'),
    'error':   CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_RESUME_DAG_IRI, 'summarize'),
    'empty':   CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_RESUME_DAG_IRI, 'summarize'),
  })

  .node(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_RESUME_DAG_IRI, 'summarize'), summarizeInsights, {
    'success': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_RESUME_DAG_IRI, 'done'),
  })

  .terminal(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_RESUME_DAG_IRI, 'done'), { outcome: 'completed' })

  .entrypoints(CARTOGRAPHER_IRIS.feedEntrypoints(CARTOGRAPHER_RESUME_DAG_IRI))

  .build();
// #endregion cartographer-resume-dag

// ── DAG 1b: insights-summary (container-ready summary body) ──────────────────

// #region insights-summary-dag
/**
 * insights-summary: embedded summary body for the browser workers topology.
 *
 * The top-level workers DAG delegates this single-cardinality stage to the
 * `io` container role after the `cpu` scatter finishes. The body is the same
 * summarizeInsights node used by the in-process cartographer DAG, packaged as a
 * registered DAG so the worker registry and JSON-LD assembly use the same
 * canonical embed/plugin surface.
 */
export const insightsSummaryDAG: DAGType = new DAGBuilder(INSIGHTS_SUMMARY_DAG_IRI, '1.0')
  .node(CARTOGRAPHER_IRIS.placementIri(INSIGHTS_SUMMARY_DAG_IRI, 'summarize'), summarizeInsights, {
    'success': CARTOGRAPHER_IRIS.placementIri(INSIGHTS_SUMMARY_DAG_IRI, 'done'),
  })
  .terminal(CARTOGRAPHER_IRIS.placementIri(INSIGHTS_SUMMARY_DAG_IRI, 'done'), { outcome: 'completed' })
  .build();
// #endregion insights-summary-dag

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
export const eventPipelineTypedDAG: DAGType = new DAGBuilder(EVENT_PIPELINE_TYPED_DAG_IRI, '1.0')

  // 1. route-event-type-variant: read eventType from 'canonical-event' metadata
  //    and dispatch to the corresponding per-type sub-DAG.
  .node(CARTOGRAPHER_IRIS.placementIri(EVENT_PIPELINE_TYPED_DAG_IRI, 'route-event-type-variant'), routeEventType, {
    'position-ping':         CARTOGRAPHER_IRIS.placementIri(EVENT_PIPELINE_TYPED_DAG_IRI, 'pipeline-position-ping'),
    'sensor-reading':        CARTOGRAPHER_IRIS.placementIri(EVENT_PIPELINE_TYPED_DAG_IRI, 'pipeline-sensor-reading'),
    'customs-event':         CARTOGRAPHER_IRIS.placementIri(EVENT_PIPELINE_TYPED_DAG_IRI, 'pipeline-customs-event'),
    'facility-scan':         CARTOGRAPHER_IRIS.placementIri(EVENT_PIPELINE_TYPED_DAG_IRI, 'pipeline-facility-scan'),
    'delivery-confirmation': CARTOGRAPHER_IRIS.placementIri(EVENT_PIPELINE_TYPED_DAG_IRI, 'pipeline-delivery-confirmation'),
  })

  // 2a. pipeline-position-ping: geo + leg measurement.
  .embed<CartographerState, CartographerState>(CARTOGRAPHER_IRIS.placementIri(EVENT_PIPELINE_TYPED_DAG_IRI, 'pipeline-position-ping'), CARTOGRAPHER_IRIS.dag.pipelinePositionPing, {
    'success': CARTOGRAPHER_IRIS.placementIri(EVENT_PIPELINE_TYPED_DAG_IRI, 'done'),
    'error':   CARTOGRAPHER_IRIS.placementIri(EVENT_PIPELINE_TYPED_DAG_IRI, 'rejected'),
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
  .embed<CartographerState, CartographerState>(CARTOGRAPHER_IRIS.placementIri(EVENT_PIPELINE_TYPED_DAG_IRI, 'pipeline-sensor-reading'), CARTOGRAPHER_IRIS.dag.pipelineSensorReading, {
    'success': CARTOGRAPHER_IRIS.placementIri(EVENT_PIPELINE_TYPED_DAG_IRI, 'done'),
    'error':   CARTOGRAPHER_IRIS.placementIri(EVENT_PIPELINE_TYPED_DAG_IRI, 'rejected'),
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
  .embed<CartographerState, CartographerState>(CARTOGRAPHER_IRIS.placementIri(EVENT_PIPELINE_TYPED_DAG_IRI, 'pipeline-customs-event'), CARTOGRAPHER_IRIS.dag.pipelineCustomsEvent, {
    'success': CARTOGRAPHER_IRIS.placementIri(EVENT_PIPELINE_TYPED_DAG_IRI, 'done'),
    'error':   CARTOGRAPHER_IRIS.placementIri(EVENT_PIPELINE_TYPED_DAG_IRI, 'rejected'),
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
  .embed<CartographerState, CartographerState>(CARTOGRAPHER_IRIS.placementIri(EVENT_PIPELINE_TYPED_DAG_IRI, 'pipeline-facility-scan'), CARTOGRAPHER_IRIS.dag.pipelineFacilityScan, {
    'success': CARTOGRAPHER_IRIS.placementIri(EVENT_PIPELINE_TYPED_DAG_IRI, 'done'),
    'error':   CARTOGRAPHER_IRIS.placementIri(EVENT_PIPELINE_TYPED_DAG_IRI, 'rejected'),
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
  .embed<CartographerState, CartographerState>(CARTOGRAPHER_IRIS.placementIri(EVENT_PIPELINE_TYPED_DAG_IRI, 'pipeline-delivery-confirmation'), CARTOGRAPHER_IRIS.dag.pipelineDeliveryConfirmation, {
    'success': CARTOGRAPHER_IRIS.placementIri(EVENT_PIPELINE_TYPED_DAG_IRI, 'done'),
    'error':   CARTOGRAPHER_IRIS.placementIri(EVENT_PIPELINE_TYPED_DAG_IRI, 'rejected'),
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

  .terminal(CARTOGRAPHER_IRIS.placementIri(EVENT_PIPELINE_TYPED_DAG_IRI, 'done'),     { outcome: 'completed' })
  .terminal(CARTOGRAPHER_IRIS.placementIri(EVENT_PIPELINE_TYPED_DAG_IRI, 'rejected'), { outcome: 'failed' })

  .build();
// #endregion event-pipeline-typed-dag

// ── DAG 1c: cartographer-workers (container variant) ─────────────────────────

// #region cartographer-workers-dag
/** Default reservoir capacity for the process-stream scatter in the workers DAG. */
export const DEFAULT_RESERVOIR_CAPACITY = 1000;

/**
 * CartographerWorkersDag: static factory for the cartographer-workers DAG and
 * its associated dispatcher bundle. Consumers call CartographerWorkersDag.build()
 * (DAG only) or CartographerWorkersDag.bundle() (full dispatcher bundle) with an
 * optional reservoir capacity override.
 *
 * DAG topology — identical to cartographerDAG with containerized boundaries:
 *   - container: 'cpu' so each typed event-pipeline body runs inside a
 *     WorkerThreadContainer/WebWorkerContainer rather than in-process.
 *   - container: 'io' so the final summary runs through the same embedded-DAG
 *     interface used by plugins and nested flows.
 *   - reservoir.capacity is parameterised; callers pass their UI-controlled
 *     batch size rather than relying on the compile-time default.
 *
 *   5 data-type entrypoints → 5 dag-feed-* embedded DAGs
 *     → gather('intake-gather', canonical-feed)
 *     → scatter('process-stream', 'canonicalEvents', { dag: 'event-pipeline-typed' },
 *               concurrency: 16, container: 'cpu', reservoir: { capacity })
 *     → gather('fold-insights', strategy: insights-fold)
 *     → embed('summarize-insights', 'insights-summary', container: 'io')
 *     → done
 */
export class CartographerWorkersDag {
  private constructor() { /* static-only */ }

  /**
   * Build the cartographer-workers DAG with the given reservoir capacity.
   * CLI, smoke tests, and dag-validate consumers use cartographerWorkersDAG
   * (the pre-built constant); the browser demo calls this with a UI-controlled value.
   */
  static build(capacity: number = DEFAULT_RESERVOIR_CAPACITY): DAGType {
    return appendCanonicalFeedGather(
      appendProducerFeedEntrypoints(new DAGBuilder(CARTOGRAPHER_DAG_IRI, '1.0'), CARTOGRAPHER_DAG_IRI),
      CARTOGRAPHER_DAG_IRI,
      CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'failed'),
    )

      .scatter(
        CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'process-stream'),
        'canonicalEvents',
        { 'dag': EVENT_PIPELINE_TYPED_DAG_IRI },
        {
          'all-success': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'fold-insights'),
          'partial':     CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'fold-insights'),
          'all-error':   CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'fold-insights'),
          'empty':       CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'summarize-insights'),
        },
        {
          'itemKey':     'canonical-event',
          'container':   'cpu',
          'execution': { 'mode': 'reservoir', 'concurrency': 16, 'reservoir': { 'keyField': 'eventType', 'capacity': capacity } },
        },
      )
      .gather(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'fold-insights'), {
        [CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'process-stream')]: {},
      }, { 'strategy': 'insights-fold' }, {
        'success': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'summarize-insights'),
        'error':   CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'summarize-insights'),
        'empty':   CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'summarize-insights'),
      })

      .embed<CartographerState, CartographerState>(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'summarize-insights'), INSIGHTS_SUMMARY_DAG_IRI, {
        'success': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'done'),
        'error':   CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'failed'),
      }, {
        'container': 'io',
      })

      .terminal(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'done'), { outcome: 'completed' })
      .terminal(CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'failed'), { outcome: 'failed' })

      .entrypoints(CARTOGRAPHER_IRIS.feedEntrypoints(CARTOGRAPHER_DAG_IRI))

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
        ...producerFeedBundle.nodes,
        ...cartographerWorkerRuntimeBundle.nodes,
      ],
      'dags': [
        ...producerFeedBundle.dags,
        ...cartographerWorkerRuntimeBundle.dags,
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
 * eventPipelineBundle: complete bundle for the shared typed event enrichment
 * body. It is self-contained: a worker registry that registers it can run both
 * the current event-pipeline-typed body and the source-payload stream-event
 * compatibility body.
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
    // typed enrichment router and source-payload compatibility decoder
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
    // Typed scatter body first, then the source-payload compatibility body.
    eventPipelineTypedDAG,
    streamEventDAG,
  ],
};

/**
 * cartographerWorkerRuntimeBundle: worker-side DAGs and nodes needed by every
 * Cartographer container role. The `cpu` role runs event-pipeline-typed bodies;
 * the `io` role runs insights-summary. Both roles use the same registry module
 * so plugin-style embedded DAGs and container dispatch stay one interface.
 */
export const cartographerWorkerRuntimeBundle: DispatcherBundleType<CartographerState> = {
  'nodes': [
    ...eventPipelineBundle.nodes,
    summarizeInsights,
  ],
  'dags': [
    ...eventPipelineBundle.dags,
    insightsSummaryDAG,
  ],
};

/**
 * cartographerBundle: top-level bundle for the cartographer DAG.
 *
 * Registration order for the streaming topology:
 *   leaf DAGs (geo-resolve, geo-pipeline, order-enrichment, gdpr-compliance)
 *   → 5 per-type pipeline DAGs
 *   → event-pipeline-typed (embeds the 5 pipeline DAGs)
 *   → stream-event compatibility body
 *   → 5 producer feed DAGs
 *   → cartographerDAG (embeds the producer feed DAGs and event-pipeline-typed)
 *
 * routeEventType is shared by the typed and source-payload bodies. The bundle
 * registrar is idempotent for same-instance re-registration.
 */
export const cartographerBundle: DispatcherBundleType<CartographerState> = {
  'nodes': [
    ...producerFeedBundle.nodes,
    ...eventPipelineBundle.nodes,
    summarizeInsights,
  ],
  'dags': [
    ...producerFeedBundle.dags,
    // eventPipelineBundle registers event-pipeline-typed and the compatibility body;
    // cartographerDAG embeds event-pipeline-typed after the producer feeds.
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
    ...producerFeedBundle.dags,
    ...eventPipelineBundle.dags,
    cartographerResumeDAG,
  ],
};
// #endregion dispatcher-bundle
