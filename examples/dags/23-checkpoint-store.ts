/**
 * 23-checkpoint-store/dags: pure module — state, node, and DAG for the
 * MemoryCheckpointStore demonstration.
 *
 * No side effects, no dispatcher, no execute.
 * Imported by examples/23-checkpoint-store.ts (the executable entry point).
 */

import {
  Batch,
  DAG_CONTEXT,
  MonadicNode,
  NodeOutput,
  NodeStateBase,
  RoutedBatch,
} from '@studnicky/dagonizer';
import type { DAGType, SchemaObjectType } from '@studnicky/dagonizer';

// ---------------------------------------------------------------------------
// State: graph-backed fields persist domain values across the
// serialisation boundary that Checkpoint.capture + restoreState impose.
// ---------------------------------------------------------------------------

// #region pipeline-state
export class PipelineState extends NodeStateBase {
  stage  = '';
  tally  = 0;
  trail: string[] = [];


}
// #endregion pipeline-state

// ---------------------------------------------------------------------------
// Nodes: each stage marks its name, increments tally, and appends to trail
// ---------------------------------------------------------------------------

export class IngestNode extends MonadicNode<PipelineState, 'success'> {
  readonly name = 'ingest';
  readonly '@id' = 'urn:noocodec:node:ingest';
  readonly outputs = ['success'] as const;
  override get outputSchema(): Record<'success', SchemaObjectType> {
    return { 'success': { 'type': 'object' } };
  }
  override async execute(batch: Batch<PipelineState>) {
    for (const item of batch) {
      item.state.stage = 'ingest';
      item.state.tally++;
      item.state.trail.push('ingest');
    }
    return RoutedBatch.create(NodeOutput.create('success').output, batch);
  }
}

export class ProcessNode extends MonadicNode<PipelineState, 'success'> {
  readonly name = 'process';
  readonly '@id' = 'urn:noocodec:node:process';
  readonly outputs = ['success'] as const;
  override get outputSchema(): Record<'success', SchemaObjectType> {
    return { 'success': { 'type': 'object' } };
  }
  override async execute(batch: Batch<PipelineState>) {
    for (const item of batch) {
      item.state.stage = 'process';
      item.state.tally++;
      item.state.trail.push('process');
    }
    return RoutedBatch.create(NodeOutput.create('success').output, batch);
  }
}

export class ExportNode extends MonadicNode<PipelineState, 'success'> {
  readonly name = 'export';
  readonly '@id' = 'urn:noocodec:node:export';
  readonly outputs = ['success'] as const;
  override get outputSchema(): Record<'success', SchemaObjectType> {
    return { 'success': { 'type': 'object' } };
  }
  override async execute(batch: Batch<PipelineState>) {
    for (const item of batch) {
      item.state.stage = 'export';
      item.state.tally++;
      item.state.trail.push('export');
    }
    return RoutedBatch.create(NodeOutput.create('success').output, batch);
  }
}

// ---------------------------------------------------------------------------
// DAG: three sequential stages: ingest -> process -> export -> end
// ---------------------------------------------------------------------------

export const dag: DAGType = {
  '@context':  DAG_CONTEXT,
  '@id': 'urn:noocodec:dag:pipeline',
  '@type':     'DAG',
  name:        'pipeline',
  version:     '1',
  entrypoints: { main: 'urn:noocodec:dag:pipeline/node/ingest' },
  nodes: [
    {
      '@id': 'urn:noocodec:dag:pipeline/node/ingest',
      '@type': 'SingleNode',
      name:    'ingest',
      node:    'urn:noocodec:node:ingest',
      outputs: { success: 'urn:noocodec:dag:pipeline/node/process' },
    },
    {
      '@id': 'urn:noocodec:dag:pipeline/node/process',
      '@type': 'SingleNode',
      name:    'process',
      node:    'urn:noocodec:node:process',
      outputs: { success: 'urn:noocodec:dag:pipeline/node/export' },
    },
    {
      '@id': 'urn:noocodec:dag:pipeline/node/export',
      '@type': 'SingleNode',
      name:    'export',
      node:    'urn:noocodec:node:export',
      outputs: { success: 'urn:noocodec:dag:pipeline/node/end' },
    },
    {
      '@id': 'urn:noocodec:dag:pipeline/node/end',
      '@type':   'TerminalNode',
      name:      'end',
      outcome:   'completed',
    },
  ],
};
