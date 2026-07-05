/**
 * 16-scatter-resume/dags: pure module — state, worker node, and DAG.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/16-scatter-resume.ts (the executable entry point).
 *
 * Demonstrates the durable-inbox scatter checkpoint model:
 *
 *   1. A scatter starts processing items from a source array.
 *   2. An AbortController cancels the run mid-flight.
 *   3. The scatter checkpoint (stored in state metadata under
 *      SCATTER_PROGRESS_KEY) captures:
 *        - `inbox`: items pulled from the source but not yet acked.
 *        - `ackedResults`: items whose body completed successfully.
 *   4. The state is snapshotted via Checkpoint.capture() and restored.
 *   5. A resumed run reprocesses inbox items first (priority), then
 *      continues the source. Already-acked items are NOT re-executed.
 *
 * The worker node records when it runs (item + run number) so we can
 * verify that acked items are skipped on resume and inbox items are retried.
 */

import {
  Batch,
  DAG_CONTEXT,
  MonadicNode,
  NodeOutputBuilder,
  NodeStateBase,
  RoutedBatchBuilder,
  SCATTER_PROGRESS_KEY,
} from '@studnicky/dagonizer';
import type { DAGType, SchemaObjectType } from '@studnicky/dagonizer';
import type { JsonObjectType } from '@studnicky/dagonizer/entities';
import { GatherStrategyNames } from '@studnicky/dagonizer/constants';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// #region state
export class ResumeState extends NodeStateBase {
  /** Source items to scatter over. */
  jobs:      string[] = [];
  /** Per-clone scalar: the node writes the processed label here. */
  processed: string   = '';
  /** Gather target: each clone's `processed` label appended in order. */
  completed: string[] = [];

  // snapshotData / restoreData so the checkpoint captures domain fields.
  // The scatter checkpoint (SCATTER_PROGRESS_KEY in metadata) is automatically
  // captured by snapshot() via the base class metadata serialization.
  protected override snapshotData(): JsonObjectType {
    return {
      "jobs":      [...this.jobs],
      "processed": this.processed,
      "completed": [...this.completed],
    };
  }

  protected override restoreData(snapshot: JsonObjectType): void {
    const jobs = snapshot['jobs'];
    if (Array.isArray(jobs)) this.jobs = jobs.filter((x): x is string => typeof x === 'string');
    const proc = snapshot['processed'];
    if (typeof proc === 'string') this.processed = proc;
    const done = snapshot['completed'];
    if (Array.isArray(done)) this.completed = done.filter((x): x is string => typeof x === 'string');
  }
  // Use the inherited NodeStateBase.restore() static method to create a
  // ResumeState from a snapshot. The base method calls applySnapshot() which
  // restores metadata (including the scatter checkpoint), retries, warnings,
  // and then calls restoreData() for domain fields. No override needed here.
}
// #endregion state

// ---------------------------------------------------------------------------
// Worker node
// ---------------------------------------------------------------------------

// #region worker-node
/**
 * Observable state shared between the node and the entry-point.
 * Using a mutable object (not a bare `let`) so ESM live bindings allow
 * the entry-point to update fields without a setter function.
 */
export const observable: {
  /** Every job body invocation across all runs, in call order. */
  execLog: string[];
  /** Current run number (1 = initial, 2 = resume). Set by the entry-point. */
  run: number;
  /**
   * Abort after this many body invocations in run 1. The node fires the
   * abort itself so the signal is in effect before the next item is pulled.
   */
  abortAfter: number;
  /** The AbortController for the current run. Set by the entry-point. */
  controller: AbortController | null;
} = {
  execLog: [],
  run: 1,
  abortAfter: 0,
  controller: null,
};

export class ProcessJobNode extends MonadicNode<ResumeState, 'done'> {
  readonly name = 'process-job';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<ResumeState>) {
    for (const item of batch) {
      const state = item.state;
      const job   = state.getter.string('job', '?');
      const label = `${job}(run-${observable.run})`;
      // Write a scalar to `processed` on the clone. The map gather reads
      // this and appends it to the parent's `completed` array.
      state.processed = label;
      // Record the body invocation in the shared external log.
      observable.execLog.push(label);
      // Fire the abort signal after the target number of invocations.
      // This happens INSIDE the worker body, before the pull loop checks the
      // signal at the top of its next iteration — guaranteeing the remaining
      // items are not pulled.
      const ctl = observable.controller;
      if (
        observable.run === 1 &&
        observable.abortAfter > 0 &&
        observable.execLog.filter((e) => e.includes('run-1')).length >= observable.abortAfter &&
        ctl !== null &&
        !ctl.signal.aborted
      ) {
        ctl.abort(new Error(`abort after ${observable.abortAfter} items`));
      }
    }
    return RoutedBatchBuilder.of(NodeOutputBuilder.of('done').output, batch);
  }
}
// #endregion worker-node

// ---------------------------------------------------------------------------
// DAG
// ---------------------------------------------------------------------------

// #region dag
export const dag: DAGType = {
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:scatter-resume',
  '@type':     'DAG',
  "name":      'scatter-resume',
  "version":   '1',
  "entrypoint": 'process-all',
  "nodes": [
    {
      '@id':       'urn:noocodex:dag:scatter-resume/node/process-all',
      '@type':     'ScatterNode',
      "name":      'process-all',
      "body":      { "node": 'process-job' },
      "source":    'jobs',
      "itemKey":   'job',
      "execution": { "mode": "item", "concurrency": 1 },              // serial so abort cuts cleanly mid-source
      "gather": {
        "strategy": GatherStrategyNames.MAP,
        "mapping":  { "processed": 'completed' }, // clone.processed (scalar) → parent.completed[]
      },
      "outputs": {
        'all-success': 'end',
        "partial":     'end',
        'all-error':   'end',
        "empty":       'end',
      },
    },
    {
      '@id':     'urn:noocodex:dag:scatter-resume/node/end',
      '@type':   'TerminalNode',
      "name":    'end',
      "outcome": 'completed',
    },
  ],
};
// #endregion dag

// Re-export SCATTER_PROGRESS_KEY so the entry-point can inspect the checkpoint.
export { SCATTER_PROGRESS_KEY };
