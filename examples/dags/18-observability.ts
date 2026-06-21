/**
 * 18-observability/dags: pure module — state, nodes, and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/18-observability.ts (the executable entry point).
 */

import {
  DAGBuilder,
  NodeOutputBuilder,
  NodeStateBase,
  ScalarNode,
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

export class ValidateNode extends ScalarNode<PipelineState, 'ok' | 'invalid'> {
  readonly name = 'validate';
  readonly outputs = ['ok', 'invalid'] as const;
  override get outputSchema(): Record<'ok' | 'invalid', SchemaObjectType> {
    return { 'ok': { 'type': 'object' }, 'invalid': { 'type': 'object' } };
  }

  protected override async executeOne(state: PipelineState) {
    state.value = 1;
    return NodeOutputBuilder.of('ok');
  }
}

export class TransformNode extends ScalarNode<PipelineState, 'done'> {
  readonly name = 'transform';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  protected override async executeOne(state: PipelineState) {
    state.value = state.value * 10;
    return NodeOutputBuilder.of('done');
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
