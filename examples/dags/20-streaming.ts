/**
 * 20-streaming/dags: pure module — state, nodes, and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/20-streaming.ts (the executable entry point).
 */

import {
  Batch,
  DAGBuilder,
  DAGIdentity,
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
  readonly '@id' = 'urn:noocodec:node:ingest';
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
  readonly '@id' = 'urn:noocodec:node:enrich';
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
  readonly '@id' = 'urn:noocodec:node:persist';
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

export const dagIri = 'urn:noocodec:dag:streaming-demo' as const;
const placement = (placementIdentifier: string): string => DAGIdentity.placementId(dagIri, placementIdentifier);

export const dag = new DAGBuilder(dagIri, '1')
  .node(placement('ingest'),  new IngestNode(),  { 'done': placement('enrich') })
  .node(placement('enrich'),  new EnrichNode(),  { 'done': placement('persist') })
  .node(placement('persist'), new PersistNode(), { 'done': placement('end') })
  .terminal(placement('end'))
  .build();
