/**
 * PipelineSensorReadingDAG: per-type pipeline for 'sensor-reading' events.
 *
 * Sensor-reading events carry IoT telemetry (temperature, shock, humidity).
 * The cold-chain-check node evaluates breaches before leg measurement.
 * No customs, no facility, no recipient, no order enrichment, no GDPR redaction.
 *
 *   parse-variant
 *     ├─parsed──► geo-pipeline (embedded)
 *     │             ├─success──► canonicalize-core
 *     │             └─error────► rejected
 *     └─invalid──► invalid
 *   canonicalize-core
 *     ├─normalized──► cold-chain-check
 *     └─rejected────► rejected
 *   cold-chain-check
 *     └─checked──► enrich-leg
 *   enrich-leg
 *     └─leg-measured──► aggregate-event
 *   aggregate-event
 *     └─done──► done
 */

// #region pipeline-sensor-reading-dag
import { parseVariant } from '../nodes/parseVariant.ts';
import { canonicalizeCore } from '../nodes/canonicalizeCore.ts';
import { coldChainCheck } from '../nodes/coldChainCheck.ts';
import { enrichLeg } from '../nodes/enrichLeg.ts';
import { aggregateEvent } from '../nodes/aggregateEvent.ts';
import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';

import type { DAG, DispatcherBundle } from '@noocodex/dagonizer';
import { DAGBuilder } from '@noocodex/dagonizer';

export const pipelineSensorReadingDAG: DAG = new DAGBuilder('pipeline-sensor-reading', '1.0')

  // 1. parse-variant: decode the event union into a typed sensor-reading shape.
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
    'normalized': 'cold-chain-check',
    'rejected':   'rejected',
  })

  // 4. cold-chain-check: temperature / shock breach evaluation for sensor telemetry.
  .node('cold-chain-check', coldChainCheck, {
    'checked': 'enrich-leg',
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

export const pipelineSensorReadingBundle: DispatcherBundle<CartographerState, CartographerServices> = {
  'nodes': [parseVariant, canonicalizeCore, coldChainCheck, enrichLeg, aggregateEvent],
  'dags':  [pipelineSensorReadingDAG],
};
// #endregion pipeline-sensor-reading-dag
