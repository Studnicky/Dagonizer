/**
 * PipelineFacilityScanDAG: per-type pipeline for 'facility-scan' events.
 *
 * Facility-scan events record a shipment passing through a warehouse or hub.
 * The full order lane runs: facility canonicalization, recipient canonicalization,
 * order-enrichment (pricing + shipping + ETA), leg measurement, and GDPR-gated
 * redaction before aggregation.
 *
 *   parse-variant
 *     ├─parsed──► geo-pipeline (embedded)
 *     │             ├─success──► canonicalize-core
 *     │             └─error────► rejected
 *     └─invalid──► invalid
 *   canonicalize-core
 *     ├─normalized──► canonicalize-facility
 *     └─rejected────► rejected
 *   canonicalize-facility
 *     └─done──► canonicalize-recipient
 *   canonicalize-recipient
 *     └─done──► order-enrichment (embedded)
 *   order-enrichment
 *     ├─success──► enrich-leg
 *     └─error────► enrich-leg
 *   enrich-leg
 *     └─leg-measured──► route-redaction
 *   route-redaction
 *     ├─needs-redaction──► gdpr (embedded)
 *     │                      ├─success──► aggregate-event
 *     │                      └─error────► aggregate-event
 *     └─skip-redaction───► aggregate-event
 *   aggregate-event
 *     └─done──► done
 */

// #region pipeline-facility-scan-dag
import { parseVariant } from '../nodes/parseVariant.ts';
import { canonicalizeCore } from '../nodes/canonicalizeCore.ts';
import { canonicalizeFacility } from '../nodes/canonicalizeFacility.ts';
import { canonicalizeRecipient } from '../nodes/canonicalizeRecipient.ts';
import { enrichLeg } from '../nodes/enrichLeg.ts';
import { routeRedaction } from '../nodes/routeRedaction.ts';
import { aggregateEvent } from '../nodes/aggregateEvent.ts';
import type { CartographerState } from '../CartographerState.ts';

import type { DAGType, DispatcherBundleType } from '@studnicky/dagonizer';
import { DAGBuilder } from '@studnicky/dagonizer';

export const pipelineFacilityScanDAG: DAGType = new DAGBuilder('pipeline-facility-scan', '1.0')

  // 1. parse-variant: decode the event union into a typed facility-scan shape.
  .node('parse-variant', parseVariant, {
    'parsed':  'geo-pipeline',
    'invalid': 'invalid',
  })

  // 2. geo-pipeline: shared geo spine (route-geo / apply-geo / validate-coords /
  //    geo-resolve). Writes geoContext + resolvedGeo + routing onto state.
  .embeddedDAG<CartographerState, CartographerState>('geo-pipeline', 'geo-pipeline', {
    'success': 'canonicalize-core',
    'error':   'rejected',
  }, {
    'inputs': {
      'raw':            'raw',
      'canonical':      'canonical',
      'routing':        'routing',
      'capturedErrors': 'capturedErrors',
    },
    'outputs': {
      'geoContext':     'geoContext',
      'resolvedGeo':    'resolvedGeo',
      'routing':        'routing',
      'capturedErrors': 'capturedErrors',
    },
  })

  // 3. canonicalize-core: scalar canonicalization using the resolved geoContext timezone.
  .node('canonicalize-core', canonicalizeCore, {
    'normalized': 'canonicalize-facility',
    'rejected':   'rejected',
  })

  // 4. canonicalize-facility: normalise the facility identifier and metadata.
  .node('canonicalize-facility', canonicalizeFacility, {
    'done': 'canonicalize-recipient',
  })

  // 5. canonicalize-recipient: normalise the recipient address and contact fields.
  .node('canonicalize-recipient', canonicalizeRecipient, {
    'done': 'order-enrichment',
  })

  // 6. order-enrichment: embedded value enrichment sub-DAG:
  //    enrich-pricing → enrich-shipping → enrich-eta.
  //    Both success and error converge on enrich-leg (enrichment is best-effort).
  .embeddedDAG<CartographerState, CartographerState>('order-enrichment', 'order-enrichment', {
    'success': 'enrich-leg',
    'error':   'enrich-leg',
  }, {
    'inputs': {
      'normalized': 'normalized',
    },
    'outputs': {
      'pricedOrder':      'pricedOrder',
      'shippingQuote':    'shippingQuote',
      'deliveryEstimate': 'deliveryEstimate',
    },
  })

  // 7. enrich-leg: legFrom → scan distance measurement (all order-lane paths converge).
  .node('enrich-leg', enrichLeg, {
    'leg-measured': 'route-redaction',
  })

  // 8. route-redaction: SKIP the redaction sub-DAG when not required.
  .node('route-redaction', routeRedaction, {
    'needs-redaction': 'gdpr',
    'skip-redaction':  'aggregate-event',
  })

  // 9. gdpr: embedded GDPR compliance sub-DAG.
  //    Both outcomes converge on aggregate-event (violation is recorded, not fatal).
  .embed('gdpr', 'gdpr-compliance', {
    'success': 'aggregate-event',
    'error':   'aggregate-event',
  }, {
    'outputs': {
      'currentEvent': 'currentEvent',
      'gdprResult':   'gdprResult',
    },
  })

  // 10. aggregate-event: write compact EnrichedShipment to state.enriched.
  .node('aggregate-event', aggregateEvent, {
    'done': 'done',
  })

  // Terminals
  .terminal('done',     { outcome: 'completed' })
  .terminal('rejected', { outcome: 'failed' })
  .terminal('invalid',  { outcome: 'failed' })

  .build();

export const pipelineFacilityScanBundle: DispatcherBundleType<CartographerState> = {
  'nodes': [parseVariant, canonicalizeCore, canonicalizeFacility, canonicalizeRecipient, enrichLeg, routeRedaction, aggregateEvent],
  'dags':  [pipelineFacilityScanDAG],
};
// #endregion pipeline-facility-scan-dag
