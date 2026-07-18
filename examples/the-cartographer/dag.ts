/**
 * The Cartographer: DAGs proving data orchestration = the same engine, on
 * source-specific feed DAGs and a first-class open gather.
 *
 * 1. cartographer (top-level):
 *    {position-ping|facility-scan|sensor-reading|customs-event|
 *     delivery-confirmation} entrypoints
 *      → per-producer dag-feed-* embedded DAGs
 *      → gather('intake-gather', strategy: source-intake)
 *      → scatter('process-stream', 'source-payload', { dag: 'stream-event' })
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
 *    feed-* opens that producer's lazy payload stream onto state.sourceFeed
 *      → done. The intake-gather's source-intake strategy merges each
 *      clone's stream into the top-level state['source-payload'] collection;
 *      no per-producer unpack/normalize/merge chain runs inside the feed DAG.
 *
 * 3. stream-event (the process-stream scatter body):
 *    decode-payload → route-event-type-variant → {position-ping|
 *      sensor-reading|customs-event|facility-scan|delivery-confirmation}
 *    Each branch is a per-type embedded DAG that starts with parse-variant,
 *    embeds geo-pipeline, runs type-specific enrichment, and converges on
 *    aggregate-event → done. stream-event accepts the canonical SourcePayload
 *    intake contract and is what cartographerDAG's process-stream scatter targets.
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
import { streamProducerFeedBundle } from './embedded-dags/ProducerFeedDAG.ts';

import type { CartographerState } from './CartographerState.ts';
import { CartographerBrowserRuntime } from './CartographerBrowserRuntime.ts';

import type { DAGType, DispatcherBundleType } from '@studnicky/dagonizer';
import { DAGBuilder } from '@studnicky/dagonizer';

import './core/SourceIntakeGather.ts';
import './core/InsightsFoldGather.ts';
// #endregion cartographer-dag-imports

const CARTOGRAPHER_DAG_IRI = CARTOGRAPHER_IRIS.dag.cartographer;
const CARTOGRAPHER_RESUME_DAG_IRI = CARTOGRAPHER_IRIS.dag.cartographerResume;
const INSIGHTS_SUMMARY_DAG_IRI = CARTOGRAPHER_IRIS.dag.insightsSummary;
const CARTOGRAPHER_DAG_WRITE_POINTS = ['NodeEdges', 'WatermarkCommit'] as const;
const CARTOGRAPHER_STREAM_SCATTER_WRITE_POINTS = [] as const;
/**
 * Write points for cartographerResumeDAG's process-stream scatter. Unlike the
 * main DAG's hot-path scatter (CARTOGRAPHER_STREAM_SCATTER_WRITE_POINTS = []),
 * this DAG exists specifically to prove durable resume, so its scatter needs
 * WatermarkCommit for a non-zero StreamCursor.resumeAfter(...) on abort.
 *
 * No FoldDeltaJournal: the framework only derives a generic per-item fold
 * contribution for the four built-in gather strategies (map/append/partition/
 * collect) — see WritePointPolicy and NodeScheduler#gatherContribution.
 * `insights-fold` is a custom GatherStrategy (InsightsFoldGather), so a
 * journaled entry would carry neither a derivable contribution nor a result
 * (its reduce() reads record.cloneState directly, not record.result), and
 * fails GatherRecordProgress schema validation. Acked items' contributions
 * already survive via the live state.insights accumulator carried across
 * abort/resume in the restored transient snapshot — see resumeState.restoreTransientState
 * below — so exactly-once still holds without journal replay for this fold.
 */
const CARTOGRAPHER_RESUME_SCATTER_WRITE_POINTS = ['WatermarkCommit'] as const;

function appendProducerStreamFeedEntrypoints(builder: DAGBuilder, dagIri: string): DAGBuilder {
  const intakeGatherIri = CARTOGRAPHER_IRIS.placementIri(dagIri, 'intake-gather');
  for (const eventType of CARTOGRAPHER_IRIS.intakeEventTypes) {
    builder.embed<CartographerState, CartographerState>(
      CARTOGRAPHER_IRIS.feedPlacementIri(dagIri, eventType),
      CARTOGRAPHER_IRIS.streamFeedDagIri(eventType),
      {
        'success': intakeGatherIri,
        'error':   intakeGatherIri,
      },
    );
  }
  return builder;
}

function appendSourceIntakeGather(builder: DAGBuilder, dagIri: string, emptyTarget: string): DAGBuilder {
  const sourceBindings = Object.fromEntries(
    CARTOGRAPHER_IRIS.intakeEventTypes.map((eventType) => [
      CARTOGRAPHER_IRIS.feedPlacementIri(dagIri, eventType),
      { 'resultField': 'sourceFeed' },
    ]),
  ) as Record<string, { readonly resultField: 'sourceFeed' }>;

  return builder.gather(
    CARTOGRAPHER_IRIS.placementIri(dagIri, 'intake-gather'),
    sourceBindings,
    { 'strategy': 'source-intake' },
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
 * Five entrypoints target five producer stream-feed DAG placements. Each feed
 * DAG opens one producer's source stream, scatters payloads through
 * ingest-source for unpack/normalize/validate, and returns source payload
 * batches to the top-level source-intake gather. The processing scatter reads
 * gathered source-payload batches at concurrency 16, runs the shared
 * source-payload event pipeline, and folds completed clone state through
 * insights-fold.
 *
 * Topology:
 *   5 data-type entrypoints → 5 dag-feed-* embedded DAGs
 *     → gather('intake-gather', source-intake)
 *     → scatter('process-stream', 'source-payload', { dag: 'stream-event' }, concurrency: 16)
 *     → gather('fold-insights', strategy: insights-fold)
 *     → summarize → done
 */
export const cartographerDAG: DAGType = appendSourceIntakeGather(
  appendProducerStreamFeedEntrypoints(new DAGBuilder(CARTOGRAPHER_DAG_IRI, '1.0', {
    'configuration': { 'durability': { 'writePoints': [...CARTOGRAPHER_DAG_WRITE_POINTS] } },
  }), CARTOGRAPHER_DAG_IRI),
  CARTOGRAPHER_DAG_IRI,
  CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'done'),
)

  .scatter(
    CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'process-stream'),
    'source-payload',
    { 'dag': CARTOGRAPHER_IRIS.dag.streamEvent },
    {
      'all-success': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'fold-insights'),
      'partial':     CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'fold-insights'),
      'all-error':   CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'fold-insights'),
      'empty':       CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_DAG_IRI, 'summarize'),
    },
    {
      'itemKey':     'source-payload',
      'configuration': {
        'execution': { 'batching': { 'mode': 'reservoir', 'concurrency': 16, 'reservoir': { 'keyField': 'eventType', 'capacity': 1000 } } },
        'durability': { 'writePoints': [...CARTOGRAPHER_STREAM_SCATTER_WRITE_POINTS] },
      },
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
 * Per-item dispatch lets the run-level abort signal fire between source-payload
 * pulls, giving a non-zero StreamCursor.resumeAfter(state,
 * 'process-stream') value on abort. Used by CartographerResumableScenario only.
 *
 * Topology (same as cartographerDAG):
 *   5 data-type entrypoints → 5 dag-feed-* embedded DAGs
 *     → gather('intake-gather', source-intake)
 *     → scatter('process-stream', 'source-payload', { dag: 'stream-event' }, concurrency: 16)
 *     → gather('fold-insights', strategy: insights-fold)
 *     → summarize → done
 */
export const cartographerResumeDAG: DAGType = appendSourceIntakeGather(
  appendProducerStreamFeedEntrypoints(new DAGBuilder(CARTOGRAPHER_RESUME_DAG_IRI, '1.0', {
    'configuration': { 'durability': { 'writePoints': [...CARTOGRAPHER_DAG_WRITE_POINTS] } },
  }), CARTOGRAPHER_RESUME_DAG_IRI),
  CARTOGRAPHER_RESUME_DAG_IRI,
  CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_RESUME_DAG_IRI, 'done'),
)

  .scatter(
    CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_RESUME_DAG_IRI, 'process-stream'),
    'source-payload',
    { 'dag': CARTOGRAPHER_IRIS.dag.streamEvent },
    {
      'all-success': CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_RESUME_DAG_IRI, 'fold-insights'),
      'partial':     CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_RESUME_DAG_IRI, 'fold-insights'),
      'all-error':   CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_RESUME_DAG_IRI, 'fold-insights'),
      'empty':       CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_RESUME_DAG_IRI, 'summarize'),
    },
    {
      'itemKey':     'source-payload',
      'configuration': {
        'execution': { 'batching': { 'mode': 'item', 'concurrency': 16 } },
        'durability': { 'writePoints': [...CARTOGRAPHER_RESUME_SCATTER_WRITE_POINTS] },
      },
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
 *     → gather('intake-gather', source-intake)
 *     → scatter('process-stream', 'source-payload', { dag: 'stream-event' },
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
  static build(
    capacity: number = DEFAULT_RESERVOIR_CAPACITY,
  ): DAGType {
    return CartographerBrowserRuntime.build({
      'execution': {
        'batching': {
          'mode': 'reservoir',
          'concurrency': 16,
          'reservoir': {
            'keyField': 'eventType',
            capacity,
            'idleMs': null,
          },
        },
      },
    });
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
        ...streamProducerFeedBundle.nodes,
        ...cartographerWorkerRuntimeBundle.nodes,
      ],
      'dags': [
        ...streamProducerFeedBundle.dags,
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
 * eventPipelineBundle: complete bundle for SourcePayload event enrichment.
 * A worker registry that combines it with the service-injected geo resolver
 * bundle can run the stream-event body.
 *
 * Registration order: leaf DAGs before DAGs that embed them.
 *   geo-source-resolve → geo-pipeline → order-enrichment → gdpr-compliance
 *   → 5 pipeline-* DAGs → stream-event
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
    // typed enrichment router and source-payload decoder
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
    // Canonical SourcePayload body.
    streamEventDAG,
  ],
};

/**
 * cartographerWorkerRuntimeBundle: worker-side DAGs and nodes needed by every
 * Cartographer container role. The `cpu` role runs stream-event bodies;
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
 *   → stream-event SourcePayload body
 *   → 5 producer feed DAGs
 *   → cartographerDAG (embeds the producer feed DAGs and stream-event)
 *
 * routeEventType dispatches decoded SourcePayload events to the per-type DAGs.
 */
export const cartographerBundle: DispatcherBundleType<CartographerState> = {
  'nodes': [
    ...streamProducerFeedBundle.nodes,
    ...eventPipelineBundle.nodes,
    summarizeInsights,
  ],
  'dags': [
    ...streamProducerFeedBundle.dags,
    // eventPipelineBundle registers the SourcePayload body after the producer feeds.
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
    ...streamProducerFeedBundle.dags,
    ...eventPipelineBundle.dags,
    cartographerResumeDAG,
  ],
};
// #endregion dispatcher-bundle
