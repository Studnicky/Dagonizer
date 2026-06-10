/**
 * 18-observability/dags: pure module — state, nodes, and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/18-observability.ts (the executable entry point).
 */

import {
  DAGBuilder,
  NodeStateBase,
} from '@noocodex/dagonizer';
import type { NodeInterface } from '@noocodex/dagonizer/contracts';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export class PipelineState extends NodeStateBase {
  value = 0;
}

// ---------------------------------------------------------------------------
// Nodes: a trivial two-step pipeline to give the observer something to trace
// ---------------------------------------------------------------------------

export const validate: NodeInterface<PipelineState, 'ok' | 'invalid'> = {
  "name":    'validate',
  "outputs": ['ok', 'invalid'],
  async execute(state) {
    state.value = 1;
    return { "output": 'ok' };
  },
};

export const transform: NodeInterface<PipelineState, 'done'> = {
  "name":    'transform',
  "outputs": ['done'],
  async execute(state) {
    state.value = state.value * 10;
    return { "output": 'done' };
  },
};

// ---------------------------------------------------------------------------
// DAG
// ---------------------------------------------------------------------------

export const dag = new DAGBuilder('observe-demo', '1')
  .node('validate', validate, { 'ok': 'transform', 'invalid': 'end-invalid' })
  .node('transform', transform, { 'done': 'end-ok' })
  .terminal('end-ok')
  .terminal('end-invalid', { outcome: 'failed' })
  .build();
