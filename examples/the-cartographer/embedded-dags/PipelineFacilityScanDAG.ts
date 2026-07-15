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

const pipelineFacilityScanDagIri = 'urn:noocodec:dag:pipeline-facility-scan' as const;
const geoPipelineDagIri = 'urn:noocodec:dag:geo-pipeline' as const;
const orderEnrichmentDagIri = 'urn:noocodec:dag:order-enrichment' as const;
const gdprComplianceDagIri = 'urn:noocodec:dag:gdpr-compliance' as const;
const placement = (placementIdentifier: string): string =>
  `${pipelineFacilityScanDagIri}/node/${placementIdentifier}`;

export const pipelineFacilityScanDAG: DAGType = new DAGBuilder(pipelineFacilityScanDagIri, '1.0')

  // 1. parse-variant: decode the event union into a typed facility-scan shape.
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
    'normalized': placement('canonicalize-facility'),
    'rejected':   placement('rejected'),
  })

  // 4. canonicalize-facility: normalise the facility identifier and metadata.
  .node(placement('canonicalize-facility'), canonicalizeFacility, {
    'done': placement('canonicalize-recipient'),
  })

  // 5. canonicalize-recipient: normalise the recipient address and contact fields.
  .node(placement('canonicalize-recipient'), canonicalizeRecipient, {
    'done': placement('order-enrichment'),
  })

  // 6. order-enrichment: embedded value enrichment sub-DAG:
  //    enrich-pricing → enrich-shipping → enrich-eta.
  //    Both success and error converge on enrich-leg (enrichment is best-effort).
  .embed<CartographerState, CartographerState>(placement('order-enrichment'), orderEnrichmentDagIri, {
    'success': placement('enrich-leg'),
    'error':   placement('enrich-leg'),
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
  .node(placement('enrich-leg'), enrichLeg, {
    'leg-measured': placement('route-redaction'),
  })

  // 8. route-redaction: SKIP the redaction sub-DAG when not required.
  .node(placement('route-redaction'), routeRedaction, {
    'needs-redaction': placement('gdpr'),
    'skip-redaction':  placement('aggregate-event'),
  })

  // 9. gdpr: embedded GDPR compliance sub-DAG.
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

  // 10. aggregate-event: write compact EnrichedShipment to state.enriched.
  .node(placement('aggregate-event'), aggregateEvent, {
    'done': placement('done'),
  })

  // Terminals
  .terminal(placement('done'),     { outcome: 'completed' })
  .terminal(placement('rejected'), { outcome: 'failed' })
  .terminal(placement('invalid'),  { outcome: 'failed' })

  .build();

export const pipelineFacilityScanBundle: DispatcherBundleType<CartographerState> = {
  'nodes': [parseVariant, canonicalizeCore, canonicalizeFacility, canonicalizeRecipient, enrichLeg, routeRedaction, aggregateEvent],
  'dags':  [pipelineFacilityScanDAG],
};
// #endregion pipeline-facility-scan-dag
