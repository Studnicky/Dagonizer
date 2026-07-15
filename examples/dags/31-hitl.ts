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
  Batch,
  DAG_CONTEXT,
  MonadicNode,
  NodeOutput,
  NodeStateBase,
  RoutedBatch,
} from '@studnicky/dagonizer';
import type { DAGType, SchemaObjectType } from '@studnicky/dagonizer';

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


}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

/**
 * PrepareNode: sets up the item that needs approval and logs the action.
 */
export class PrepareNode extends MonadicNode<HitlState, 'ready'> {
  readonly name = 'prepare';
  readonly '@id' = 'urn:noocodec:node:prepare';
  readonly outputs = ['ready'] as const;
  override get outputSchema(): Record<'ready', SchemaObjectType> {
    return { 'ready': { 'type': 'object' } };
  }

  override async execute(batch: Batch<HitlState>) {
    for (const item of batch) {
      item.state.item = 'Purchase Order #4201 — $4,800';
      item.state.log.push(`prepared: ${item.state.item}`);
    }
    return RoutedBatch.create(NodeOutput.create('ready').output, batch);
  }
}

/**
 * ApproveNode: parks on first run (writes correlationKey to metadata and
 * routes 'parked'). On resume (when decision is pre-set), routes accordingly.
 *
 * The engine intercepts the 'parked' output before routing, so the placement
 * does not need a 'parked' → next-node mapping in the DAG.
 */
export class ApproveNode extends MonadicNode<HitlState, 'parked' | 'approved' | 'rejected'> {
  readonly name = 'approve';
  readonly '@id' = 'urn:noocodec:node:approve';
  readonly outputs = ['parked', 'approved', 'rejected'] as const;
  override get outputSchema(): Record<'parked' | 'approved' | 'rejected', SchemaObjectType> {
    return {
      'parked':   { 'type': 'object' },
      'approved': { 'type': 'object' },
      'rejected': { 'type': 'object' },
    };
  }

  override async execute(batch: Batch<HitlState>) {
    const entries: Array<readonly ['parked' | 'approved' | 'rejected', Batch<HitlState>]> = [];
    for (const item of batch) {
      const state = item.state;
      if (state.decision === 'approved') {
        state.log.push('decision: approved');
        entries.push([NodeOutput.create('approved').output, Batch.from([item])]);
        continue;
      }
      if (state.decision === 'rejected') {
        state.log.push('decision: rejected');
        entries.push([NodeOutput.create('rejected').output, Batch.from([item])]);
        continue;
      }

      // No decision yet — park and wait for human input.
      // Write the correlationKey so the caller can correlate the resume.
      const correlationKey = `approval:${state.item.replace(/[^a-zA-Z0-9]/g, '-')}`;
      state.setMetadata('correlationKey', correlationKey);
      state.log.push(`parked: awaiting approval for "${state.item}"`);
      entries.push([NodeOutput.create('parked').output, Batch.from([item])]);
    }
    return RoutedBatch.create(entries);
  }
}

/**
 * ProcessNode: executes after an approved decision.
 */
export class ProcessNode extends MonadicNode<HitlState, 'done'> {
  readonly name = 'process';
  readonly '@id' = 'urn:noocodec:node:process';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<HitlState>) {
    for (const item of batch) item.state.log.push(`processed: ${item.state.item}`);
    return RoutedBatch.create(NodeOutput.create('done').output, batch);
  }
}

// ---------------------------------------------------------------------------
// DAG
// ---------------------------------------------------------------------------

export const dag: DAGType = {
  '@context':  DAG_CONTEXT,
  '@id': 'urn:noocodec:dag:hitl',
  '@type':     'DAG',
  'name':      'hitl',
  'version':   '1',
  'entrypoints': { 'main': 'urn:noocodec:dag:hitl/node/prepare' },
  'nodes': [
    {
      '@id': 'urn:noocodec:dag:hitl/node/prepare',
      '@type':   'SingleNode',
      'name':    'prepare',
      'node':    'urn:noocodec:node:prepare',
      'outputs': { 'ready': 'urn:noocodec:dag:hitl/node/approve' },
    },
    {
      '@id': 'urn:noocodec:dag:hitl/node/approve',
      '@type':   'SingleNode',
      'name':    'approve',
      'node':    'urn:noocodec:node:approve',
      // 'parked' output is NOT listed here — the engine intercepts it.
      'outputs': { 'approved': 'urn:noocodec:dag:hitl/node/process', 'rejected': 'urn:noocodec:dag:hitl/node/rejected-end' },
    },
    {
      '@id': 'urn:noocodec:dag:hitl/node/process',
      '@type':   'SingleNode',
      'name':    'process',
      'node':    'urn:noocodec:node:process',
      'outputs': { 'done': 'urn:noocodec:dag:hitl/node/end' },
    },
    {
      '@id': 'urn:noocodec:dag:hitl/node/end',
      '@type':    'TerminalNode',
      'name':     'end',
      'outcome':  'completed',
    },
    {
      '@id': 'urn:noocodec:dag:hitl/node/rejected-end',
      '@type':    'TerminalNode',
      'name':     'rejected-end',
      'outcome':  'failed',
    },
  ],
};
