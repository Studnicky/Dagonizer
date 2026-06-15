/**
 * preRunSetup: deterministic `pre`-phase node.
 *
 * Runs before the DAG entrypoint via a `PhaseNode` placement with
 * `phase: 'pre'`. Two responsibilities:
 *
 *   1. Stamp `state.runId` — a collision-resistant identifier derived
 *      from the wall-clock timestamp. Every downstream node that writes
 *      to the memory store (recordFindings, StateProjection) uses this
 *      to key the per-run named graph (`urn:dagonizer:state:<runId>`).
 *
 *   2. Clear the prior-run draft so a resumed flow does not expose a
 *      stale response from a previous interrupted execution.
 *
 * kind: 'deterministic' — pure function of the wall clock; no LLM, no I/O.
 * output: 'ready' — always routes forward; the `pre` phase never gates.
 *
 * Wiring (once enabled in dag.ts):
 *   DAGBuilder.phase('setup', 'pre', preRunSetup)
 */

// #region pre-phase-setup
import { NodeOutputBuilder, ScalarNode } from '@noocodex/dagonizer';
import type { NodeContextInterface } from '@noocodex/dagonizer';

import type { ArchivistState } from '../ArchivistState.ts';
import type { ArchivistServices } from '../services.ts';

export class PreRunSetupNode extends ScalarNode<ArchivistState, 'ready', ArchivistServices> {
  readonly name = 'pre-run-setup';
  readonly outputs = ['ready'] as const;

  protected override executeOne(state: ArchivistState, context: NodeContextInterface<ArchivistServices>) {
    // Stamp a per-run identifier that downstream memory-write nodes key their
    // named graph on.  Format: ISO timestamp with milliseconds, URL-safe.
    // crypto.randomUUID() would be stronger but wall-clock is deterministic
    // across replays (same input → same id), which matters for snapshot tests.
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    state.runId = runId;

    // Clear any draft from a prior interrupted execution so a resumed run
    // does not accidentally serve stale content.
    state.draft = '';
    state.approvalState = 'pending';

    context.services.logger.info(
      `pre-run-setup: runId=${runId} query="${state.query.slice(0, 60)}"`,
    );

    return Promise.resolve(NodeOutputBuilder.of('ready'));
  }
}
// #endregion pre-phase-setup

/** Singleton node instance referenced by the DAG wiring. */
export const preRunSetup = new PreRunSetupNode();
