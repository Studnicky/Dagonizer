/**
 * 20-streaming/dags: pure module — state, nodes, and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/20-streaming.ts (the executable entry point).
 */

import {
  Batch,
  DAGBuilder,
  MonadicNode,
  NodeOutput,
  NodeStateBase,
  RoutedBatch,
} from '@studnicky/dagonizer';
import type { SchemaObjectType } from '@studnicky/dagonizer';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export class PipelineState extends NodeStateBase {
  items: string[] = [];
}

// ---------------------------------------------------------------------------
// Nodes: each stage appends to `items` so the consumer can see progress
// ---------------------------------------------------------------------------

export class IngestNode extends MonadicNode<PipelineState, 'done'> {
  readonly name = 'ingest';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }
  override async execute(batch: Batch<PipelineState>) {
    for (const item of batch) item.state.items.push('raw-data');
    return RoutedBatch.create(NodeOutput.create('done').output, batch);
  }
}

export class EnrichNode extends MonadicNode<PipelineState, 'done'> {
  readonly name = 'enrich';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }
  override async execute(batch: Batch<PipelineState>) {
    for (const item of batch) item.state.items.push('enriched-data');
    return RoutedBatch.create(NodeOutput.create('done').output, batch);
  }
}

export class PersistNode extends MonadicNode<PipelineState, 'done'> {
  readonly name = 'persist';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }
  override async execute(batch: Batch<PipelineState>) {
    for (const item of batch) item.state.items.push('persisted');
    return RoutedBatch.create(NodeOutput.create('done').output, batch);
  }
}

// ---------------------------------------------------------------------------
// DAG: a linear three-step pipeline
// ---------------------------------------------------------------------------

export const dag = new DAGBuilder('streaming-demo', '1')
  .node('ingest',  new IngestNode(),  { 'done': 'enrich' })
  .node('enrich',  new EnrichNode(),  { 'done': 'persist' })
  .node('persist', new PersistNode(), { 'done': 'end' })
  .terminal('end')
  .build();
