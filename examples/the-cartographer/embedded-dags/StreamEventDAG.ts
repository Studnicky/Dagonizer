/**
 * StreamEventDAG: the streaming scatter body for source-payload-based dispatch.
 *
 * Reads a scattered SourcePayload from metadata key 'source-payload', decodes it
 * inline via decode-payload (TypedPayloadDecoder + CanonicalEventVariantBuilder),
 * and routes the resulting CanonicalEventVariant to one of five per-type embedded
 * DAGs via route-event-type-variant. Invalid payloads (absent, undecodable, or
 * shipmentId-less) route to 'rejected'.
 *
 * Topology:
 *   decode-payload
 *     ├─decoded──► route-event-type-variant
 *     │              ├─position-ping──────────► pipeline-position-ping (embedded)
 *     │              ├─sensor-reading─────────► pipeline-sensor-reading (embedded)
 *     │              ├─customs-event──────────► pipeline-customs-event (embedded)
 *     │              ├─facility-scan──────────► pipeline-facility-scan (embedded)
 *     │              └─delivery-confirmation──► pipeline-delivery-confirmation (embedded)
 *     │            Each per-type DAG converges on done/rejected.
 *     └─invalid──► rejected
 *
 * streamEventBundle is the fragment dag.ts imports to register both nodes and the
 * DAG with the dispatcher (the bundle registrar is idempotent for same-instance
 * re-registration, so routeEventType being listed in both bundles is safe).
 */

import type { CartographerState } from '../CartographerState.ts';
import { decodePayload } from '../nodes/decodePayload.ts';
import { routeEventType } from '../nodes/routeEventType.ts';
import { CARTOGRAPHER_IRIS } from '../cartographerIds.ts';

import type { DAGType, DispatcherBundleType } from '@studnicky/dagonizer';
import { DAGBuilder } from '@studnicky/dagonizer';

// #region stream-event-dag
const STREAM_EVENT_DAG_IRI = CARTOGRAPHER_IRIS.dag.streamEvent;

export const streamEventDAG: DAGType = new DAGBuilder(STREAM_EVENT_DAG_IRI, '1.0')

  // 1. decode-payload: reads 'source-payload' metadata, decodes wire format
  //    (json/csv/ndjson/yaml, optionally gzip), builds CanonicalEventVariant,
  //    and sets state.canonicalVariant. Routes 'decoded' or 'invalid'.
  .node(CARTOGRAPHER_IRIS.placementIri(STREAM_EVENT_DAG_IRI, 'decode-payload'), decodePayload, {
    'decoded': CARTOGRAPHER_IRIS.placementIri(STREAM_EVENT_DAG_IRI, 'route-event-type-variant'),
    'invalid': CARTOGRAPHER_IRIS.placementIri(STREAM_EVENT_DAG_IRI, 'rejected'),
  })

  // 2. route-event-type-variant: reads state.canonicalVariant.eventType and
  //    dispatches to the corresponding per-type sub-DAG. Sets state.routing.
  .node(CARTOGRAPHER_IRIS.placementIri(STREAM_EVENT_DAG_IRI, 'route-event-type-variant'), routeEventType, {
    'position-ping':         CARTOGRAPHER_IRIS.placementIri(STREAM_EVENT_DAG_IRI, 'pipeline-position-ping'),
    'sensor-reading':        CARTOGRAPHER_IRIS.placementIri(STREAM_EVENT_DAG_IRI, 'pipeline-sensor-reading'),
    'customs-event':         CARTOGRAPHER_IRIS.placementIri(STREAM_EVENT_DAG_IRI, 'pipeline-customs-event'),
    'facility-scan':         CARTOGRAPHER_IRIS.placementIri(STREAM_EVENT_DAG_IRI, 'pipeline-facility-scan'),
    'delivery-confirmation': CARTOGRAPHER_IRIS.placementIri(STREAM_EVENT_DAG_IRI, 'pipeline-delivery-confirmation'),
  })

  // 3a. pipeline-position-ping: geo + leg measurement.
  .embed<CartographerState, CartographerState>(CARTOGRAPHER_IRIS.placementIri(STREAM_EVENT_DAG_IRI, 'pipeline-position-ping'), CARTOGRAPHER_IRIS.dag.pipelinePositionPing, {
    'success': CARTOGRAPHER_IRIS.placementIri(STREAM_EVENT_DAG_IRI, 'done'),
    'error':   CARTOGRAPHER_IRIS.placementIri(STREAM_EVENT_DAG_IRI, 'rejected'),
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

  // 3b. pipeline-sensor-reading: geo + cold-chain + leg measurement.
  .embed<CartographerState, CartographerState>(CARTOGRAPHER_IRIS.placementIri(STREAM_EVENT_DAG_IRI, 'pipeline-sensor-reading'), CARTOGRAPHER_IRIS.dag.pipelineSensorReading, {
    'success': CARTOGRAPHER_IRIS.placementIri(STREAM_EVENT_DAG_IRI, 'done'),
    'error':   CARTOGRAPHER_IRIS.placementIri(STREAM_EVENT_DAG_IRI, 'rejected'),
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

  // 3c. pipeline-customs-event: geo + customs-dwell + leg measurement.
  .embed<CartographerState, CartographerState>(CARTOGRAPHER_IRIS.placementIri(STREAM_EVENT_DAG_IRI, 'pipeline-customs-event'), CARTOGRAPHER_IRIS.dag.pipelineCustomsEvent, {
    'success': CARTOGRAPHER_IRIS.placementIri(STREAM_EVENT_DAG_IRI, 'done'),
    'error':   CARTOGRAPHER_IRIS.placementIri(STREAM_EVENT_DAG_IRI, 'rejected'),
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

  // 3d. pipeline-facility-scan: geo + facility canonicalization + order enrichment
  //     + GDPR-gated redaction.
  .embed<CartographerState, CartographerState>(CARTOGRAPHER_IRIS.placementIri(STREAM_EVENT_DAG_IRI, 'pipeline-facility-scan'), CARTOGRAPHER_IRIS.dag.pipelineFacilityScan, {
    'success': CARTOGRAPHER_IRIS.placementIri(STREAM_EVENT_DAG_IRI, 'done'),
    'error':   CARTOGRAPHER_IRIS.placementIri(STREAM_EVENT_DAG_IRI, 'rejected'),
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

  // 3e. pipeline-delivery-confirmation: geo + recipient canonicalization +
  //     delivery confirmation + GDPR-gated redaction.
  .embed<CartographerState, CartographerState>(CARTOGRAPHER_IRIS.placementIri(STREAM_EVENT_DAG_IRI, 'pipeline-delivery-confirmation'), CARTOGRAPHER_IRIS.dag.pipelineDeliveryConfirmation, {
    'success': CARTOGRAPHER_IRIS.placementIri(STREAM_EVENT_DAG_IRI, 'done'),
    'error':   CARTOGRAPHER_IRIS.placementIri(STREAM_EVENT_DAG_IRI, 'rejected'),
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

  .terminal(CARTOGRAPHER_IRIS.placementIri(STREAM_EVENT_DAG_IRI, 'done'),     { outcome: 'completed' })
  .terminal(CARTOGRAPHER_IRIS.placementIri(STREAM_EVENT_DAG_IRI, 'rejected'), { outcome: 'failed' })

  .build();

/**
 * Bundle fragment for dag.ts. Registers decode-payload, route-event-type-variant,
 * and the stream-event DAG with the dispatcher. routeEventType re-registration is
 * a no-op (same instance; the bundle registrar is idempotent).
 */
export const streamEventBundle: DispatcherBundleType<CartographerState> = {
  'nodes': [decodePayload, routeEventType],
  'dags':  [streamEventDAG],
};
// #endregion stream-event-dag
