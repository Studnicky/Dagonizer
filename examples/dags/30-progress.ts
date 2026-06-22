/**
 * 30-progress/dags: pure module — state, nodes, and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/30-progress.ts (the executable entry point).
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

export class ProgressState extends NodeStateBase {
  items: string[] = [];
  enriched: string[] = [];
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export class FetchNode extends ScalarNode<ProgressState, 'done' | 'empty'> {
  readonly name = 'fetch';
  readonly outputs = ['done', 'empty'] as const;
  override get outputSchema(): Record<'done' | 'empty', SchemaObjectType> {
    return {
      'done':  { 'type': 'object' },
      'empty': { 'type': 'object' },
    };
  }

  protected override async executeOne(state: ProgressState) {
    state.items = ['alpha', 'beta', 'gamma'];
    return NodeOutputBuilder.of(state.items.length > 0 ? 'done' : 'empty');
  }
}

export class EnrichNode extends ScalarNode<ProgressState, 'done'> {
  readonly name = 'enrich';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  protected override async executeOne(state: ProgressState) {
    state.enriched = state.items.map((item) => `${item}:enriched`);
    return NodeOutputBuilder.of('done');
  }
}

// ---------------------------------------------------------------------------
// DAG
// ---------------------------------------------------------------------------

const fetchNode = new FetchNode();
const enrichNode = new EnrichNode();

export const dag = new DAGBuilder('progress-demo', '1')
  .node('fetch', fetchNode, { 'done': 'enrich', 'empty': 'end-empty' })
  .node('enrich', enrichNode, { 'done': 'end-ok' })
  .terminal('end-ok')
  .terminal('end-empty', { outcome: 'failed' })
  .build();
