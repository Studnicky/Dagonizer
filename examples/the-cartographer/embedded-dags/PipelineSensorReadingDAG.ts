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

import type { DAGType, DispatcherBundleType } from '@studnicky/dagonizer';
import { DAGBuilder } from '@studnicky/dagonizer';

const pipelineSensorReadingDagIri = 'urn:noocodec:dag:pipeline-sensor-reading' as const;
const geoPipelineDagIri = 'urn:noocodec:dag:geo-pipeline' as const;
const placement = (placementIdentifier: string): string =>
  `${pipelineSensorReadingDagIri}/node/${placementIdentifier}`;

export const pipelineSensorReadingDAG: DAGType = new DAGBuilder(pipelineSensorReadingDagIri, '1.0')

  // 1. parse-variant: decode the event union into a typed sensor-reading shape.
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
    'normalized': placement('cold-chain-check'),
    'rejected':   placement('rejected'),
  })

  // 4. cold-chain-check: temperature / shock breach evaluation for sensor telemetry.
  .node(placement('cold-chain-check'), coldChainCheck, {
    'checked': placement('enrich-leg'),
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

export const pipelineSensorReadingBundle: DispatcherBundleType<CartographerState> = {
  'nodes': [parseVariant, canonicalizeCore, coldChainCheck, enrichLeg, aggregateEvent],
  'dags':  [pipelineSensorReadingDAG],
};
// #endregion pipeline-sensor-reading-dag
