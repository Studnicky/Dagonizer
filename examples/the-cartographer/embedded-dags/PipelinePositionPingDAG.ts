/**
 * PipelinePositionPingDAG: per-type pipeline for 'position-ping' events.
 *
 * Position-ping events carry GPS coordinates only — no cold-chain, no customs,
 * no facility, no recipient, no order, no GDPR-required PII. The lane is the
 * minimal geo + measurement path:
 *
 *   parse-variant
 *     ├─parsed──► geo-pipeline (embedded)
 *     │             ├─success──► canonicalize-core
 *     │             └─error────► rejected
 *     └─invalid──► invalid
 *   canonicalize-core
 *     ├─normalized──► enrich-leg
 *     └─rejected────► rejected
 *   enrich-leg
 *     └─leg-measured──► aggregate-event
 *   aggregate-event
 *     └─done──► done
 */

// #region pipeline-position-ping-dag
import { parseVariant } from '../nodes/parseVariant.ts';
import { canonicalizeCore } from '../nodes/canonicalizeCore.ts';
import { enrichLeg } from '../nodes/enrichLeg.ts';
import { aggregateEvent } from '../nodes/aggregateEvent.ts';
import type { CartographerState } from '../CartographerState.ts';

import type { DAGType, DispatcherBundleType } from '@studnicky/dagonizer';
import { DAGBuilder, DAGIdentity } from '@studnicky/dagonizer';

const pipelinePositionPingDagIri = 'urn:noocodec:dag:pipeline-position-ping' as const;
const geoPipelineDagIri = 'urn:noocodec:dag:geo-pipeline' as const;
const placement = (placementIdentifier: string): string =>
  DAGIdentity.placementId(pipelinePositionPingDagIri, placementIdentifier);

export const pipelinePositionPingDAG: DAGType = new DAGBuilder(pipelinePositionPingDagIri, '1.0')

  // 1. parse-variant: decode the event union into a typed position-ping shape.
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

  // 3. canonicalize-core: scalar canonicalization (timestamps, country codes,
  //    weight units, carrier labels) using the resolved geoContext timezone.
  .node(placement('canonicalize-core'), canonicalizeCore, {
    'normalized': placement('enrich-leg'),
    'rejected':   placement('rejected'),
  })

  // 4. enrich-leg: legFrom → scan distance measurement.
  .node(placement('enrich-leg'), enrichLeg, {
    'leg-measured': placement('aggregate-event'),
  })

  // 5. aggregate-event: write compact EnrichedShipment to state.enriched.
  .node(placement('aggregate-event'), aggregateEvent, {
    'done': placement('done'),
  })

  // Terminals
  .terminal(placement('done'),    { outcome: 'completed' })
  .terminal(placement('rejected'), { outcome: 'failed' })
  .terminal(placement('invalid'),  { outcome: 'failed' })

  .build();

export const pipelinePositionPingBundle: DispatcherBundleType<CartographerState> = {
  'nodes': [parseVariant, canonicalizeCore, enrichLeg, aggregateEvent],
  'dags':  [pipelinePositionPingDAG],
};
// #endregion pipeline-position-ping-dag
