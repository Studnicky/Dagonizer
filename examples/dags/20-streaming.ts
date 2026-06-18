/**
 * 20-streaming/dags: pure module — state, nodes, and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/20-streaming.ts (the executable entry point).
 */

import {
  DAGBuilder,
  NodeOutputBuilder,
  NodeStateBase,
  ScalarNode,
} from '@studnicky/dagonizer';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export class PipelineState extends NodeStateBase {
  items: string[] = [];
}

// ---------------------------------------------------------------------------
// Nodes: each stage appends to `items` so the consumer can see progress
// ---------------------------------------------------------------------------

export class IngestNode extends ScalarNode<PipelineState, 'done'> {
  readonly name = 'ingest';
  readonly outputs = ['done'] as const;
  protected override async executeOne(state: PipelineState) {
    state.items.push('raw-data');
    return NodeOutputBuilder.of('done');
  }
}

export class EnrichNode extends ScalarNode<PipelineState, 'done'> {
  readonly name = 'enrich';
  readonly outputs = ['done'] as const;
  protected override async executeOne(state: PipelineState) {
    state.items.push('enriched-data');
    return NodeOutputBuilder.of('done');
  }
}

export class PersistNode extends ScalarNode<PipelineState, 'done'> {
  readonly name = 'persist';
  readonly outputs = ['done'] as const;
  protected override async executeOne(state: PipelineState) {
    state.items.push('persisted');
    return NodeOutputBuilder.of('done');
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
