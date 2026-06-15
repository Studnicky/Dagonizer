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
import type { CartographerServices } from '../CartographerServices.ts';

import type { DAG, DispatcherBundle } from '@noocodex/dagonizer';
import { DAGBuilder } from '@noocodex/dagonizer';

export const pipelinePositionPingDAG: DAG = new DAGBuilder('pipeline-position-ping', '1.0')

  // 1. parse-variant: decode the event union into a typed position-ping shape.
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
      'raw':       'raw',
      'canonical': 'canonical',
      'routing':   'routing',
    },
    'outputs': {
      'geoContext':  'geoContext',
      'resolvedGeo': 'resolvedGeo',
      'routing':     'routing',
    },
  })

  // 3. canonicalize-core: scalar canonicalization (timestamps, country codes,
  //    weight units, carrier aliases) using the resolved geoContext timezone.
  .node('canonicalize-core', canonicalizeCore, {
    'normalized': 'enrich-leg',
    'rejected':   'rejected',
  })

  // 4. enrich-leg: legFrom → scan distance measurement.
  .node('enrich-leg', enrichLeg, {
    'leg-measured': 'aggregate-event',
  })

  // 5. aggregate-event: write compact EnrichedShipment to state.enriched.
  .node('aggregate-event', aggregateEvent, {
    'done': 'done',
  })

  // Terminals
  .terminal('done',    { outcome: 'completed' })
  .terminal('rejected', { outcome: 'failed' })
  .terminal('invalid',  { outcome: 'failed' })

  .build();

export const pipelinePositionPingBundle: DispatcherBundle<CartographerState, CartographerServices> = {
  'nodes': [parseVariant, canonicalizeCore, enrichLeg, aggregateEvent],
  'dags':  [pipelinePositionPingDAG],
};
// #endregion pipeline-position-ping-dag
