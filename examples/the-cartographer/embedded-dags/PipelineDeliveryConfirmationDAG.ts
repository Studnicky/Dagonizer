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

const pipelineDeliveryConfirmationDagIri = 'urn:noocodec:dag:pipeline-delivery-confirmation' as const;
const geoPipelineDagIri = 'urn:noocodec:dag:geo-pipeline' as const;
const gdprComplianceDagIri = 'urn:noocodec:dag:gdpr-compliance' as const;
const placement = (placementIdentifier: string): string =>
  `${pipelineDeliveryConfirmationDagIri}/node/${placementIdentifier}`;

export const pipelineDeliveryConfirmationDAG: DAGType = new DAGBuilder(pipelineDeliveryConfirmationDagIri, '1.0')

  // 1. parse-variant: decode the event union into a typed delivery-confirmation shape.
  .node(placement('parse-variant'), parseVariant, {
    'parsed':  placement('geo-pipeline'),
    'invalid': placement('invalid'),
  })

  // 2. geo-pipeline: shared geo spine (route-geo / apply-geo / validate-coords /
  //    geo-resolve). Writes geoContext + resolvedGeo + routing onto state.
  .embed<CartographerState, CartographerState>(placement('geo-pipeline'), geoPipelineDagIri, {
    'success': placement('canonicalize-core'),
    'error':   placement('rejected'),
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
  .node(placement('canonicalize-core'), canonicalizeCore, {
    'normalized': placement('canonicalize-recipient'),
    'rejected':   placement('rejected'),
  })

  // 4. canonicalize-recipient: normalise the recipient address and contact fields.
  .node(placement('canonicalize-recipient'), canonicalizeRecipient, {
    'done': placement('confirm-delivery'),
  })

  // 5. confirm-delivery: record the final handoff — signature, POD, timestamp.
  .node(placement('confirm-delivery'), confirmDelivery, {
    'confirmed': placement('enrich-leg'),
  })

  // 6. enrich-leg: legFrom → scan distance measurement.
  .node(placement('enrich-leg'), enrichLeg, {
    'leg-measured': placement('route-redaction'),
  })

  // 7. route-redaction: SKIP the redaction sub-DAG when not required.
  .node(placement('route-redaction'), routeRedaction, {
    'needs-redaction': placement('gdpr'),
    'skip-redaction':  placement('aggregate-event'),
  })

  // 8. gdpr: embedded GDPR compliance sub-DAG.
  //    Both outcomes converge on aggregate-event (violation is recorded, not fatal).
  .embed(placement('gdpr'), gdprComplianceDagIri, {
    'success': placement('aggregate-event'),
    'error':   placement('aggregate-event'),
  }, {
    'outputs': {
      'currentEvent': 'currentEvent',
      'gdprResult':   'gdprResult',
    },
  })

  // 9. aggregate-event: write compact EnrichedShipment to state.enriched.
  .node(placement('aggregate-event'), aggregateEvent, {
    'done': placement('done'),
  })

  // Terminals
  .terminal(placement('done'),     { outcome: 'completed' })
  .terminal(placement('rejected'), { outcome: 'failed' })
  .terminal(placement('invalid'),  { outcome: 'failed' })

  .build();

export const pipelineDeliveryConfirmationBundle: DispatcherBundleType<CartographerState> = {
  'nodes': [parseVariant, canonicalizeCore, canonicalizeRecipient, confirmDelivery, enrichLeg, routeRedaction, aggregateEvent],
  'dags':  [pipelineDeliveryConfirmationDAG],
};
// #endregion pipeline-delivery-confirmation-dag
