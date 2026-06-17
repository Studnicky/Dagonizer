/**
 * PipelinePositionPingBatchDAG: batch pipeline for 'position-ping' events.
 *
 * Processes a homogeneous SourcePayload[] batch (all position-ping) already
 * decoded into state.variantBatch by decode-batch. The lane is the minimal
 * geo + measurement path, operating in parallel on all items:
 *
 *   parse-variant-batch
 *     └─parsed──► geo-pipeline-batch
 *                   └─resolved──► canonicalize-core-batch
 *                                   └─normalized──► enrich-leg-batch
 *                                                     └─leg-measured──► aggregate-event-batch
 *                                                                         └─done──► done
 *
 * Mirrors PipelinePositionPingDAG exactly, with each node operating over
 * the whole batch array in one executeOne call rather than one event at a time.
 */

// #region pipeline-position-ping-batch-dag
import { parseVariantBatch }     from '../nodes/parseVariantBatch.ts';
import { geoPipelineBatch }      from '../nodes/geoPipelineBatch.ts';
import { canonicalizeCoreBatch } from '../nodes/canonicalizeCoreBatch.ts';
import { enrichLegBatch }        from '../nodes/enrichLegBatch.ts';
import { aggregateEventBatch }   from '../nodes/aggregateEventBatch.ts';
import type { CartographerState }    from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';

import type { DAG, DispatcherBundle } from '@noocodex/dagonizer';
import { DAGBuilder } from '@noocodex/dagonizer';

export const pipelinePositionPingBatchDAG: DAG = new DAGBuilder('pipeline-position-ping-batch', '1.0')

  // 1. parse-variant-batch: project variantBatch into rawBatch + currentEventBatch.
  .node('parse-variant-batch', parseVariantBatch, {
    'parsed': 'geo-pipeline-batch',
  })

  // 2. geo-pipeline-batch: per-item geo resolution (route-geo / apply-geo /
  //    validate-coords / reverse-geocode / route-modalities / ip-geolocate / fuse-geo).
  //    Writes geoContextBatch, resolvedGeoBatch, routingBatch.
  .node('geo-pipeline-batch', geoPipelineBatch, {
    'resolved': 'canonicalize-core-batch',
  })

  // 3. canonicalize-core-batch: per-item scalar canonicalization using the resolved
  //    geoContextBatch[i].timezone. Writes normalizedBatch.
  .node('canonicalize-core-batch', canonicalizeCoreBatch, {
    'normalized': 'enrich-leg-batch',
  })

  // 4. enrich-leg-batch: per-item legFrom → scan distance. Writes legKmBatch.
  .node('enrich-leg-batch', enrichLegBatch, {
    'leg-measured': 'aggregate-event-batch',
  })

  // 5. aggregate-event-batch: assemble enrichedBatch from all per-stage arrays.
  .node('aggregate-event-batch', aggregateEventBatch, {
    'done': 'done',
  })

  .terminal('done', { outcome: 'completed' })

  .build();

export const pipelinePositionPingBatchBundle: DispatcherBundle<CartographerState, CartographerServices> = {
  'nodes': [parseVariantBatch, geoPipelineBatch, canonicalizeCoreBatch, enrichLegBatch, aggregateEventBatch],
  'dags':  [pipelinePositionPingBatchDAG],
};
// #endregion pipeline-position-ping-batch-dag
