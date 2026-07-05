/**
 * 08-checkpoint/dags: pure module — state and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/08-checkpoint.ts (the executable entry point).
 */

import {
  Batch,
  DAG_CONTEXT,
  MonadicNode,
  NodeOutputBuilder,
  NodeStateBase,
  RoutedBatchBuilder,
} from '@studnicky/dagonizer';
import type { DAGType, SchemaObjectType } from '@studnicky/dagonizer';
import type { JsonObjectType } from '@studnicky/dagonizer/entities';

// ---------------------------------------------------------------------------
// State: overrides snapshot/restore to persist domain fields
// ---------------------------------------------------------------------------

// #region counting-state
export class CountingState extends NodeStateBase {
  count = 0;
  log:  string[] = [];

  /**
   * Serialize domain fields into a plain JSON-serialisable object.
   * Called by Checkpoint.capture() to capture state at the abort point.
   */
  protected override snapshotData(): JsonObjectType {
    return { "count": this.count, "log": [...this.log] };
  }

  /**
   * Restore domain fields from a previously-captured snapshot.
   * Called by CountingState.restore() after the parse step.
   */
  protected override restoreData(snapshot: JsonObjectType): void {
    const c = snapshot['count'];
    if (typeof c === 'number') this.count = c;
    const l = snapshot['log'];
    if (Array.isArray(l)) this.log = l.filter((x): x is string => typeof x === 'string');
  }
}
// #endregion counting-state

// ---------------------------------------------------------------------------
// Node: increments count and records each tick in log
// ---------------------------------------------------------------------------

export class IncNode extends MonadicNode<CountingState, 'success'> {
  readonly name = 'inc';
  readonly outputs = ['success'] as const;
  override get outputSchema(): Record<'success', SchemaObjectType> {
    return { 'success': { 'type': 'object' } };
  }

  override async execute(batch: Batch<CountingState>) {
    for (const item of batch) {
      item.state.count++;
      item.state.log.push(`tick:${item.state.count}`);
    }
    return RoutedBatchBuilder.of(NodeOutputBuilder.of('success').output, batch);
  }
}

// ---------------------------------------------------------------------------
// DAG: three sequential inc placements: a -> b -> c -> end
// ---------------------------------------------------------------------------

export const dag: DAGType = {
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:count',
  '@type':     'DAG',
  "name":        'count',
  "version":     '1',
  "entrypoint":  'a',
  "nodes": [
    {
      '@id':   'urn:noocodex:dag:count/node/a',
      '@type': 'SingleNode',
      "name":    'a',
      "node":    'inc',
      "outputs": { "success": 'b' },  // routes to 'b' on success
    },
    {
      '@id':   'urn:noocodex:dag:count/node/b',
      '@type': 'SingleNode',
      "name":    'b',
      "node":    'inc',
      "outputs": { "success": 'c' },  // routes to 'c' on success
    },
    {
      '@id':   'urn:noocodex:dag:count/node/c',
      '@type': 'SingleNode',
      "name":    'c',
      "node":    'inc',
      "outputs": { "success": 'end' },  // routes to canonical terminal
    },
    {
      '@id':     'urn:noocodex:dag:count/node/end',
      '@type':   'TerminalNode',
      "name":    'end',
      "outcome": 'completed',
    },
  ],
};
