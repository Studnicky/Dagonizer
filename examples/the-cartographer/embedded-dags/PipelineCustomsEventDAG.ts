/**
 * PipelineCustomsEventDAG: per-type pipeline for 'customs-event' events.
 *
 * Customs events record clearance dwell hours at a border crossing.
 * The customs-dwell node computes clearance time before leg measurement.
 * No cold-chain, no facility, no recipient, no order enrichment, no GDPR redaction.
 *
 *   parse-variant
 *     ├─parsed──► geo-pipeline (embedded)
 *     │             ├─success──► canonicalize-core
 *     │             └─error────► rejected
 *     └─invalid──► invalid
 *   canonicalize-core
 *     ├─normalized──► customs-dwell
 *     └─rejected────► rejected
 *   customs-dwell
 *     └─dwelled──► enrich-leg
 *   enrich-leg
 *     └─leg-measured──► aggregate-event
 *   aggregate-event
 *     └─done──► done
 */

// #region pipeline-customs-event-dag
import { parseVariant } from '../nodes/parseVariant.ts';
import { canonicalizeCore } from '../nodes/canonicalizeCore.ts';
import { customsDwell } from '../nodes/customsDwell.ts';
import { enrichLeg } from '../nodes/enrichLeg.ts';
import { aggregateEvent } from '../nodes/aggregateEvent.ts';
import type { CartographerState } from '../CartographerState.ts';

import type { DAGType, DispatcherBundleType } from '@studnicky/dagonizer';
import { DAGBuilder } from '@studnicky/dagonizer';

const pipelineCustomsEventDagIri = 'urn:noocodec:dag:pipeline-customs-event' as const;
const geoPipelineDagIri = 'urn:noocodec:dag:geo-pipeline' as const;
const placement = (placementIdentifier: string): string =>
  `${pipelineCustomsEventDagIri}/node/${placementIdentifier}`;

export const pipelineCustomsEventDAG: DAGType = new DAGBuilder(pipelineCustomsEventDagIri, '1.0')

  // 1. parse-variant: decode the event union into a typed customs-event shape.
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
    'normalized': placement('customs-dwell'),
    'rejected':   placement('rejected'),
  })

  // 4. customs-dwell: border clearance dwell hours computation.
  .node(placement('customs-dwell'), customsDwell, {
    'dwelled': placement('enrich-leg'),
  })

  // 5. enrich-leg: legFrom → scan distance measurement.
  .node(placement('enrich-leg'), enrichLeg, {
    'leg-measured': placement('aggregate-event'),
  })

  // 6. aggregate-event: write compact EnrichedShipment to state.enriched.
  .node(placement('aggregate-event'), aggregateEvent, {
    'done': placement('done'),
  })

  // Terminals
  .terminal(placement('done'),     { outcome: 'completed' })
  .terminal(placement('rejected'), { outcome: 'failed' })
  .terminal(placement('invalid'),  { outcome: 'failed' })

  .build();

export const pipelineCustomsEventBundle: DispatcherBundleType<CartographerState> = {
  'nodes': [parseVariant, canonicalizeCore, customsDwell, enrichLeg, aggregateEvent],
  'dags':  [pipelineCustomsEventDAG],
};
// #endregion pipeline-customs-event-dag
