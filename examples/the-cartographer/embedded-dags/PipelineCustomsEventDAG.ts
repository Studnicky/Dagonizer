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
import type { CartographerServices } from '../CartographerServices.ts';

import type { DAG, DispatcherBundle } from '@studnicky/dagonizer';
import { DAGBuilder } from '@studnicky/dagonizer';

export const pipelineCustomsEventDAG: DAG = new DAGBuilder('pipeline-customs-event', '1.0')

  // 1. parse-variant: decode the event union into a typed customs-event shape.
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

  // 3. canonicalize-core: scalar canonicalization using the resolved geoContext timezone.
  .node('canonicalize-core', canonicalizeCore, {
    'normalized': 'customs-dwell',
    'rejected':   'rejected',
  })

  // 4. customs-dwell: border clearance dwell hours computation.
  .node('customs-dwell', customsDwell, {
    'dwelled': 'enrich-leg',
  })

  // 5. enrich-leg: legFrom → scan distance measurement.
  .node('enrich-leg', enrichLeg, {
    'leg-measured': 'aggregate-event',
  })

  // 6. aggregate-event: write compact EnrichedShipment to state.enriched.
  .node('aggregate-event', aggregateEvent, {
    'done': 'done',
  })

  // Terminals
  .terminal('done',     { outcome: 'completed' })
  .terminal('rejected', { outcome: 'failed' })
  .terminal('invalid',  { outcome: 'failed' })

  .build();

export const pipelineCustomsEventBundle: DispatcherBundle<CartographerState, CartographerServices> = {
  'nodes': [parseVariant, canonicalizeCore, customsDwell, enrichLeg, aggregateEvent],
  'dags':  [pipelineCustomsEventDAG],
};
// #endregion pipeline-customs-event-dag
