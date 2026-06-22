/**
 * PipelineDeliveryConfirmationDAG: per-type pipeline for 'delivery-confirmation' events.
 *
 * Delivery-confirmation events record final handoff to the recipient.
 * Recipient canonicalization and delivery confirmation run before leg measurement.
 * GDPR redaction applies (recipient PII). No order-enrichment — pricing and ETA
 * are computed at facility-scan (dispatch); the terminal delivery event records
 * only the delivery fact, not a new cost estimate.
 *
 *   parse-variant
 *     ├─parsed──► geo-pipeline (embedded)
 *     │             ├─success──► canonicalize-core
 *     │             └─error────► rejected
 *     └─invalid──► invalid
 *   canonicalize-core
 *     ├─normalized──► canonicalize-recipient
 *     └─rejected────► rejected
 *   canonicalize-recipient
 *     └─done──► confirm-delivery
 *   confirm-delivery
 *     └─confirmed──► enrich-leg
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

// #region pipeline-delivery-confirmation-dag
import { parseVariant } from '../nodes/parseVariant.ts';
import { canonicalizeCore } from '../nodes/canonicalizeCore.ts';
import { canonicalizeRecipient } from '../nodes/canonicalizeRecipient.ts';
import { confirmDelivery } from '../nodes/confirmDelivery.ts';
import { enrichLeg } from '../nodes/enrichLeg.ts';
import { routeRedaction } from '../nodes/routeRedaction.ts';
import { aggregateEvent } from '../nodes/aggregateEvent.ts';
import type { CartographerState } from '../CartographerState.ts';

import type { DAGType, DispatcherBundleType } from '@studnicky/dagonizer';
import { DAGBuilder } from '@studnicky/dagonizer';

export const pipelineDeliveryConfirmationDAG: DAGType = new DAGBuilder('pipeline-delivery-confirmation', '1.0')

  // 1. parse-variant: decode the event union into a typed delivery-confirmation shape.
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
    'normalized': 'canonicalize-recipient',
    'rejected':   'rejected',
  })

  // 4. canonicalize-recipient: normalise the recipient address and contact fields.
  .node('canonicalize-recipient', canonicalizeRecipient, {
    'done': 'confirm-delivery',
  })

  // 5. confirm-delivery: record the final handoff — signature, POD, timestamp.
  .node('confirm-delivery', confirmDelivery, {
    'confirmed': 'enrich-leg',
  })

  // 6. enrich-leg: legFrom → scan distance measurement.
  .node('enrich-leg', enrichLeg, {
    'leg-measured': 'route-redaction',
  })

  // 7. route-redaction: SKIP the redaction sub-DAG when not required.
  .node('route-redaction', routeRedaction, {
    'needs-redaction': 'gdpr',
    'skip-redaction':  'aggregate-event',
  })

  // 8. gdpr: embedded GDPR compliance sub-DAG.
  //    Both outcomes converge on aggregate-event (violation is recorded, not fatal).
  .embeddedDAG('gdpr', 'gdpr-compliance', {
    'success': 'aggregate-event',
    'error':   'aggregate-event',
  }, {
    'outputs': {
      'currentEvent': 'currentEvent',
      'gdprResult':   'gdprResult',
    },
  })

  // 9. aggregate-event: write compact EnrichedShipment to state.enriched.
  .node('aggregate-event', aggregateEvent, {
    'done': 'done',
  })

  // Terminals
  .terminal('done',     { outcome: 'completed' })
  .terminal('rejected', { outcome: 'failed' })
  .terminal('invalid',  { outcome: 'failed' })

  .build();

export const pipelineDeliveryConfirmationBundle: DispatcherBundleType<CartographerState> = {
  'nodes': [parseVariant, canonicalizeCore, canonicalizeRecipient, confirmDelivery, enrichLeg, routeRedaction, aggregateEvent],
  'dags':  [pipelineDeliveryConfirmationDAG],
};
// #endregion pipeline-delivery-confirmation-dag
