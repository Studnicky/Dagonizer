/**
 * CanonicalizeDAG: the make-canonical domain sub-DAG.
 *
 * Runs AFTER geo resolution so that normalize has the timezone and jurisdiction
 * already set on state.geoContext. The two nodes form a single conceptual domain:
 *   normalize  — scalar canonicalization (timestamps, carrier aliases, country codes,
 *                weight units; derives LOCAL time from state.geoContext.timezone)
 *   classify   — derive eventType / serviceTier / sizeTier; project state.currentEvent
 *
 *   normalize
 *     ├─rejected─► rejected  (TerminalNode failed — unparseable scan timestamp)
 *     └─normalized─► classify
 *   classify
 *     └─classified─► canonical  (TerminalNode completed)
 *
 * Embedded in event-pipeline between geo and route-kind:
 *   .embeddedDAG('canonicalize', 'canonicalize',
 *     { 'success': 'route-kind', 'error': 'rejected' },
 *     {
 *       'inputs':  { 'raw': 'raw', 'geoContext': 'geoContext' },
 *       'outputs': { 'normalized': 'normalized', 'currentEvent': 'currentEvent' },
 *     })
 *
 * The child state is seeded with the parent's raw scan and geoContext so normalize
 * reads the correct timezone. On completion, normalized and currentEvent are copied
 * back to the parent clone.
 */

// #region canonicalize-dag
import { normalize }  from '../nodes/normalize.ts';
import { classify }   from '../nodes/classify.ts';
import type { CartographerState }   from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';

import type { DispatcherBundle } from '@noocodex/dagonizer';
import { DAGBuilder }            from '@noocodex/dagonizer/builder';
import type { DAG }              from '@noocodex/dagonizer/entities';

export const canonicalizeDAG: DAG = new DAGBuilder('canonicalize', '1.0')

  // 1. normalize: scalar canonicalization (runs after geo; needs geoContext.timezone).
  .node('normalize', normalize, {
    'normalized': 'classify',
    'rejected':   'rejected',
  })

  // 2. classify: derive eventType / serviceTier / sizeTier; project currentEvent.
  .node('classify', classify, {
    'classified': 'canonical',
  })

  // Terminals
  .terminal('canonical', 'completed')
  .terminal('rejected',  'failed')

  .build();

export const canonicalizeBundle: DispatcherBundle<CartographerState, CartographerServices> = {
  'nodes': [normalize, classify],
  'dags':  [canonicalizeDAG],
};
// #endregion canonicalize-dag
