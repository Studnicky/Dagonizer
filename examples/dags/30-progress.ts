/**
 * 30-progress/dags: pure module — state, nodes, and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/30-progress.ts (the executable entry point).
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

export class ProgressState extends NodeStateBase {
  items: string[] = [];
  enriched: string[] = [];
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export class FetchNode extends MonadicNode<ProgressState, 'done' | 'empty'> {
  readonly name = 'fetch';
  readonly outputs = ['done', 'empty'] as const;
  override get outputSchema(): Record<'done' | 'empty', SchemaObjectType> {
    return {
      'done':  { 'type': 'object' },
      'empty': { 'type': 'object' },
    };
  }

  override async execute(batch: Batch<ProgressState>) {
    const entries: Array<readonly ['done' | 'empty', Batch<ProgressState>]> = [];
    for (const item of batch) {
      item.state.items = ['alpha', 'beta', 'gamma'];
      const output = NodeOutput.create(item.state.items.length > 0 ? 'done' : 'empty');
      entries.push([output.output, Batch.from([item])]);
    }
    return RoutedBatch.create(entries);
  }
}

export class EnrichNode extends MonadicNode<ProgressState, 'done'> {
  readonly name = 'enrich';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<ProgressState>) {
    for (const item of batch) {
      item.state.enriched = item.state.items.map((value) => `${value}:enriched`);
    }
    return RoutedBatch.create(NodeOutput.create('done').output, batch);
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
