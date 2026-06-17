/**
 * StreamEventBatchDAG: the streaming scatter body for source-batch-based dispatch.
 *
 * Reads a scattered SourcePayload[] from metadata key 'source-batch', decodes
 * the entire homogeneous batch via decode-batch, and routes it to the
 * corresponding per-type batch pipeline via route-batch-event-type.
 *
 * For this wave only position-ping is wired to an active batch pipeline;
 * all other event types route to 'rejected' until their batch pipelines are built.
 *
 * Topology:
 *   decode-batch
 *     ├─decoded──► route-batch-event-type
 *     │              ├─position-ping──► pipeline-position-ping-batch (embedded)
 *     │              │                    └─done──► done
 *     │              └─rejected──────────────────────────► rejected
 *     └─invalid──► rejected
 *
 * streamEventBatchBundle is the fragment imported by dag.ts to register all new
 * nodes and DAGs with the dispatcher alongside the existing per-event bundle.
 */

// #region stream-event-batch-dag
import { decodeBatch }           from '../nodes/decodeBatch.ts';
import { routeBatchEventType }   from '../nodes/routeBatchEventType.ts';
import type { CartographerState }    from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';

import type { DAG, DispatcherBundle } from '@noocodex/dagonizer';
import { DAGBuilder } from '@noocodex/dagonizer';

export const streamEventBatchDAG: DAG = new DAGBuilder('stream-event-batch', '1.0')

  // 1. decode-batch: reads 'source-batch' metadata (a SourcePayload[]), decodes
  //    each item via TypedPayloadDecoder + CanonicalEventVariantBuilder, drops
  //    shipmentId-less items, and sets state.batchEventType + state.variantBatch.
  .node('decode-batch', decodeBatch, {
    'decoded': 'route-batch-event-type',
    'invalid': 'rejected',
  })

  // 2. route-batch-event-type: reads state.batchEventType and dispatches to the
  //    matching per-type batch pipeline. Only position-ping is active this wave.
  .node('route-batch-event-type', routeBatchEventType, {
    'position-ping': 'pipeline-position-ping-batch',
    'rejected':      'rejected',
  })

  // 3a. pipeline-position-ping-batch: geo + leg measurement over the whole batch.
  //     Writes state.enrichedBatch (read by the insights-fold-batch gather).
  .embeddedDAG<CartographerState, CartographerState>('pipeline-position-ping-batch', 'pipeline-position-ping-batch', {
    'success': 'done',
    'error':   'rejected',
  }, {
    'outputs': {
      'variantBatch':    'variantBatch',
      'rawBatch':        'rawBatch',
      'normalizedBatch': 'normalizedBatch',
      'geoContextBatch': 'geoContextBatch',
      'resolvedGeoBatch': 'resolvedGeoBatch',
      'routingBatch':    'routingBatch',
      'legKmBatch':      'legKmBatch',
      'enrichedBatch':   'enrichedBatch',
    },
  })

  .terminal('done',     { outcome: 'completed' })
  .terminal('rejected', { outcome: 'failed' })

  .build();

/**
 * Bundle fragment for dag.ts. Registers decode-batch, routeBatchEventType,
 * all five batch pipeline nodes, and the two batch DAGs with the dispatcher.
 */
import { parseVariantBatch }     from '../nodes/parseVariantBatch.ts';
import { geoPipelineBatch }      from '../nodes/geoPipelineBatch.ts';
import { canonicalizeCoreBatch } from '../nodes/canonicalizeCoreBatch.ts';
import { enrichLegBatch }        from '../nodes/enrichLegBatch.ts';
import { aggregateEventBatch }   from '../nodes/aggregateEventBatch.ts';
import { pipelinePositionPingBatchDAG } from './PipelinePositionPingBatchDAG.ts';

export const streamEventBatchBundle: DispatcherBundle<CartographerState, CartographerServices> = {
  'nodes': [
    // decode and route nodes
    decodeBatch,
    routeBatchEventType,
    // position-ping batch pipeline nodes
    parseVariantBatch,
    geoPipelineBatch,
    canonicalizeCoreBatch,
    enrichLegBatch,
    aggregateEventBatch,
  ],
  'dags': [
    pipelinePositionPingBatchDAG,
    streamEventBatchDAG,
  ],
};
// #endregion stream-event-batch-dag
