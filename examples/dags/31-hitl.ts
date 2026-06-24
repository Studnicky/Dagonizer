/**
 * 31-hitl/dags: pure module — state and DAG const for the HITL
 * park-and-correlate example.
 *
 * No side effects, no dispatcher, no execute.
 * Imported by examples/31-hitl.ts (the executable entry point).
 *
 * Flow:
 *   prepare → approve(park) ──resume──▶ process → end(completed)
 *                           └─ rejected ──────────▶ rejected-end(failed)
 */

import {
  DAG_CONTEXT,
  NodeOutputBuilder,
  NodeStateBase,
  ScalarNode,
} from '@studnicky/dagonizer';
import type { DAGType, SchemaObjectType } from '@studnicky/dagonizer';
import type { JsonObjectType } from '@studnicky/dagonizer/entities';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export class HitlState extends NodeStateBase {
  /** The item that requires approval. */
  item = '';
  /** Set by the caller before resuming to communicate the human decision. */
  decision: 'approved' | 'rejected' | '' = '';
  /** Execution log used to verify the example output. */
  log: string[] = [];

  protected override snapshotData(): JsonObjectType {
    return { 'item': this.item, 'decision': this.decision, 'log': [...this.log] };
  }

  protected override restoreData(snapshot: JsonObjectType): void {
    const item = snapshot['item'];
    if (typeof item === 'string') this.item = item;
    const decision = snapshot['decision'];
    if (decision === 'approved' || decision === 'rejected') this.decision = decision;
    const log = snapshot['log'];
    if (Array.isArray(log)) this.log = log.filter((x): x is string => typeof x === 'string');
  }
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

/**
 * PrepareNode: sets up the item that needs approval and logs the action.
 */
export class PrepareNode extends ScalarNode<HitlState, 'ready'> {
  readonly name = 'prepare';
  readonly outputs = ['ready'] as const;
  override get outputSchema(): Record<'ready', SchemaObjectType> {
    return { 'ready': { 'type': 'object' } };
  }

  protected override async executeOne(state: HitlState) {
    state.item = 'Purchase Order #4201 — $4,800';
    state.log.push(`prepared: ${state.item}`);
    return NodeOutputBuilder.of('ready');
  }
}

/**
 * ApproveNode: parks on first run (writes correlationKey to metadata and
 * routes 'parked'). On resume (when decision is pre-set), routes accordingly.
 *
 * The engine intercepts the 'parked' output before routing, so the placement
 * does not need a 'parked' → next-node mapping in the DAG.
 */
export class ApproveNode extends ScalarNode<HitlState, 'parked' | 'approved' | 'rejected'> {
  readonly name = 'approve';
  readonly outputs = ['parked', 'approved', 'rejected'] as const;
  override get outputSchema(): Record<'parked' | 'approved' | 'rejected', SchemaObjectType> {
    return {
      'parked':   { 'type': 'object' },
      'approved': { 'type': 'object' },
      'rejected': { 'type': 'object' },
    };
  }

  protected override async executeOne(state: HitlState) {
    if (state.decision === 'approved') {
      state.log.push('decision: approved');
      return NodeOutputBuilder.of('approved');
    }
    if (state.decision === 'rejected') {
      state.log.push('decision: rejected');
      return NodeOutputBuilder.of('rejected');
    }

    // No decision yet — park and wait for human input.
    // Write the correlationKey so the caller can correlate the resume.
    const correlationKey = `approval:${state.item.replace(/[^a-zA-Z0-9]/g, '-')}`;
    state.setMetadata('correlationKey', correlationKey);
    state.log.push(`parked: awaiting approval for "${state.item}"`);
    return NodeOutputBuilder.of('parked');
  }
}

/**
 * ProcessNode: executes after an approved decision.
 */
export class ProcessNode extends ScalarNode<HitlState, 'done'> {
  readonly name = 'process';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  protected override async executeOne(state: HitlState) {
    state.log.push(`processed: ${state.item}`);
    return NodeOutputBuilder.of('done');
  }
}

// ---------------------------------------------------------------------------
// DAG
// ---------------------------------------------------------------------------

export const dag: DAGType = {
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:hitl',
  '@type':     'DAG',
  'name':      'hitl',
  'version':   '1',
  'entrypoint': 'prepare',
  'nodes': [
    {
      '@id':     'urn:noocodex:dag:hitl/node/prepare',
      '@type':   'SingleNode',
      'name':    'prepare',
      'node':    'prepare',
      'outputs': { 'ready': 'approve' },
    },
    {
      '@id':     'urn:noocodex:dag:hitl/node/approve',
      '@type':   'SingleNode',
      'name':    'approve',
      'node':    'approve',
      // 'parked' output is NOT listed here — the engine intercepts it.
      'outputs': { 'approved': 'process', 'rejected': 'rejected-end' },
    },
    {
      '@id':     'urn:noocodex:dag:hitl/node/process',
      '@type':   'SingleNode',
      'name':    'process',
      'node':    'process',
      'outputs': { 'done': 'end' },
    },
    {
      '@id':      'urn:noocodex:dag:hitl/node/end',
      '@type':    'TerminalNode',
      'name':     'end',
      'outcome':  'completed',
    },
    {
      '@id':      'urn:noocodex:dag:hitl/node/rejected-end',
      '@type':    'TerminalNode',
      'name':     'rejected-end',
      'outcome':  'failed',
    },
  ],
};
