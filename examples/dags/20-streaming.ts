/**
 * 20-streaming/dags: pure module — state, nodes, and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/20-streaming.ts (the executable entry point).
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
  items: string[] = [];
}

// ---------------------------------------------------------------------------
// Nodes: each stage appends to `items` so the consumer can see progress
// ---------------------------------------------------------------------------

export const ingest: NodeInterface<PipelineState, 'done'> = {
  "name":    'ingest',
  "outputs": ['done'],
  async execute(state) {
    state.items.push('raw-data');
    return { "output": 'done' };
  },
};

export const enrich: NodeInterface<PipelineState, 'done'> = {
  "name":    'enrich',
  "outputs": ['done'],
  async execute(state) {
    state.items.push('enriched-data');
    return { "output": 'done' };
  },
};

export const persist: NodeInterface<PipelineState, 'done'> = {
  "name":    'persist',
  "outputs": ['done'],
  async execute(state) {
    state.items.push('persisted');
    return { "output": 'done' };
  },
};

// ---------------------------------------------------------------------------
// DAG: a linear three-step pipeline
// ---------------------------------------------------------------------------

export const dag = new DAGBuilder('streaming-demo', '1')
  .node('ingest',  ingest,  { 'done': 'enrich' })
  .node('enrich',  enrich,  { 'done': 'persist' })
  .node('persist', persist, { 'done': 'end' })
  .terminal('end')
  .build();
