/**
 * 11-handoff: two DAGs chained via an InMemoryChannel.
 *
 * DAG A collects items and ends at a terminal named "handoff". The
 * dispatcher is constructed with `channels: { handoff: channel }`. When
 * DAG A reaches that terminal the engine builds a DAGHandoff envelope
 * containing the full state snapshot and publishes it to the channel.
 *
 * A HandoffChannel subclass overrides the protected `onPublished` hook to
 * restore the envelope state into a fresh PipelineState and immediately run
 * DAG B on a second dispatcher. DAG B reads the items that DAG A collected and
 * produces a summary.
 *
 * In production the channel would serialize the envelope to a message
 * queue or event bus and a separate host would call `PipelineState.restore`
 * before executing DAG B. The in-process loopback here demonstrates the
 * envelope as the unit of cross-host state pass-over without any cloud SDK.
 *
 * DAG definitions (state, nodes, dags): examples/dags/11-handoff.ts
 *
 * Run: npx tsx examples/11-handoff.ts
 */

import { Dagonizer, InMemoryChannel } from '@studnicky/dagonizer';
import { JsonObject } from '@studnicky/dagonizer/entities';
import type { DAGHandoffType } from '@studnicky/dagonizer/entities';

import {
  PipelineState,
  CollectANode,
  CollectBNode,
  CollectCNode,
  dagA,
  dagB,
  SummarizeNode,
} from './dags/11-handoff.js';

// ---------------------------------------------------------------------------
// DAG B dispatcher: receives state from the channel and summarizes it
// ---------------------------------------------------------------------------

// #region dag-b-dispatcher
const dispatcherB = new Dagonizer<PipelineState>();
dispatcherB.registerNode(new SummarizeNode());
dispatcherB.registerDAG(dagB);
// #endregion dag-b-dispatcher

// ---------------------------------------------------------------------------
// Channel: the hand-off transport. Subclass InMemoryChannel and override the
// protected onPublished hook to restore the envelope state and run DAG B (zero
// callbacks — the override IS the extension point). The same pattern works
// across process/host boundaries: replace the in-process execute() with a queue
// consumer on the receiving host.
// ---------------------------------------------------------------------------

// #region channel
class HandoffChannel extends InMemoryChannel {
  // The most recent DAG B result, written by the override after each publish.
  lastResultState: PipelineState | null = null;

  protected override async onPublished(handoff: DAGHandoffType): Promise<void> {
    // Restore the state snapshot carried by the envelope.
    // DAGHandoff is a discriminated union (stateSnapshot vs stateSnapshotRef);
    // narrow to the by-value branch before calling restore.
    if (!('stateSnapshot' in handoff)) return;
    const snapshot: unknown = handoff.stateSnapshot;
    if (!JsonObject.is(snapshot)) return;
    const continuationState = PipelineState.restore(snapshot);

    // Execute DAG B on the restored state.
    const result = await dispatcherB.execute('pipeline-b', continuationState);
    this.lastResultState = result.state;
  }
}

const channel = new HandoffChannel();
// #endregion channel

// ---------------------------------------------------------------------------
// DAG A dispatcher: collect items then hand off
// ---------------------------------------------------------------------------

// #region dag-a-dispatcher
const dispatcherA = new Dagonizer<PipelineState>({
  // Bind the "handoff" terminal to the channel.
  // When DAG A reaches the terminal named "handoff" the engine publishes
  // a DAGHandoff envelope to this channel.
  "channels": { "handoff": channel },
});
dispatcherA.registerNode(new CollectANode());
dispatcherA.registerNode(new CollectBNode());
dispatcherA.registerNode(new CollectCNode());
dispatcherA.registerDAG(dagA);
// #endregion dag-a-dispatcher

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const stateA = new PipelineState();
await dispatcherA.execute('pipeline-a', stateA);

process.stdout.write('\nHandoff: DAG A → InMemoryChannel → DAG B\n');
process.stdout.write(`\nDAG A result (items collected):\n`);
process.stdout.write(`  items: ${JSON.stringify(stateA.items)}\n`);
process.stdout.write(`  terminal: handoff (envelope published to channel)\n`);

process.stdout.write(`\nEnvelopes published: ${channel.published.length}\n`);
if (channel.published.length > 0) {
  const env = channel.published[0];
  if (env !== undefined) {
    process.stdout.write(`  dagName:       ${env.dagName}\n`);
    process.stdout.write(`  terminalName:  ${env.terminalName}\n`);
    process.stdout.write(`  terminalOutput:${env.terminalOutput}\n`);
    process.stdout.write(`  correlationId: ${env.correlationId}\n`);
  }
}

process.stdout.write(`\nDAG B result (summary from restored state):\n`);
if (channel.lastResultState !== null) {
  process.stdout.write(`  summary: ${channel.lastResultState.summary}\n`);
}

process.stdout.write('\nLesson: the DAGHandoff envelope carries the full state snapshot.\n');
process.stdout.write('        Any host that can call PipelineState.restore() can continue\n');
process.stdout.write('        the pipeline — no shared in-process memory required.\n');
