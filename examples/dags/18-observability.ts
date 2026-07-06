/**
 * 18-observability/dags: pure module — state, nodes, and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/18-observability.ts (the executable entry point).
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
  value = 0;
}

// ---------------------------------------------------------------------------
// Nodes: a trivial two-step pipeline to give the observer something to trace
// ---------------------------------------------------------------------------

export class ValidateNode extends MonadicNode<PipelineState, 'ok' | 'invalid'> {
  readonly name = 'validate';
  readonly outputs = ['ok', 'invalid'] as const;
  override get outputSchema(): Record<'ok' | 'invalid', SchemaObjectType> {
    return { 'ok': { 'type': 'object' }, 'invalid': { 'type': 'object' } };
  }

  override async execute(batch: Batch<PipelineState>) {
    for (const item of batch) item.state.value = 1;
    return RoutedBatch.create(NodeOutput.create('ok').output, batch);
  }
}

export class TransformNode extends MonadicNode<PipelineState, 'done'> {
  readonly name = 'transform';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<PipelineState>) {
    for (const item of batch) item.state.value = item.state.value * 10;
    return RoutedBatch.create(NodeOutput.create('done').output, batch);
  }
}

// ---------------------------------------------------------------------------
// DAG
// ---------------------------------------------------------------------------

const validateNode = new ValidateNode();
const transformNode = new TransformNode();

export const dag = new DAGBuilder('observe-demo', '1')
  .node('validate', validateNode, { 'ok': 'transform', 'invalid': 'end-invalid' })
  .node('transform', transformNode, { 'done': 'end-ok' })
  .terminal('end-ok')
  .terminal('end-invalid', { outcome: 'failed' })
  .build();
