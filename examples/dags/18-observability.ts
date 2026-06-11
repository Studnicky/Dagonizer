/**
 * 18-observability/dags: pure module — state, nodes, and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/18-observability.ts (the executable entry point).
 */

import {
  DAGBuilder,
  NodeOutputBuilder,
  NodeStateBase,
  EMPTY_CONTRACT_FRAGMENT,
  Timeout,
} from '@noocodex/dagonizer';
import type { NodeInterface } from '@noocodex/dagonizer';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export class PipelineState extends NodeStateBase {
  value = 0;
}

// ---------------------------------------------------------------------------
// Nodes: a trivial two-step pipeline to give the observer something to trace
// ---------------------------------------------------------------------------

export class ValidateNode implements NodeInterface<PipelineState, 'ok' | 'invalid'> {
  readonly contract = EMPTY_CONTRACT_FRAGMENT;
  readonly timeout = Timeout.none();
  readonly name = 'validate';
  readonly outputs = ['ok', 'invalid'] as const;

  async execute(state: PipelineState) {
    state.value = 1;
    return NodeOutputBuilder.of('ok');
  }
}

export class TransformNode implements NodeInterface<PipelineState, 'done'> {
  readonly contract = EMPTY_CONTRACT_FRAGMENT;
  readonly timeout = Timeout.none();
  readonly name = 'transform';
  readonly outputs = ['done'] as const;

  async execute(state: PipelineState) {
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
