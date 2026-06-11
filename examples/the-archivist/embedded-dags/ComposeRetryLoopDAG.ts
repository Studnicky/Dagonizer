/**
 * ComposeRetryLoopDAG: reusable compose / validate / retry loop.
 *
 * Internal flow:
 *
 *   compose-response
 *     └─ drafted ──► validate-response
 *          ├─ approved  ──► END (success) ─► parent: respond-to-visitor
 *          ├─ retry     ──► compose-response   (bounded by the retry budget on state (retriesFor('compose')))
 *          └─ exhausted ──► END (success) ─► parent: respond-to-visitor
 *
 * Outputs:
 *   success: draft composed (approved or best-effort); parent routes to
 *             the shared respond-to-visitor terminal.
 *   error:   clone-state errors accumulated (propagated by the parent
 *             ScatterNode to the parent's 'error' branch)
 *
 * Convergence policy: this sub-DAG does NOT contain respondToVisitor. It is a
 * pure compose/validate unit that produces state.draft and exits. The
 * single shared respond-to-visitor placement lives at the parent DAG level
 * so that every converging branch strikes exactly one terminal node per run.
 *
 * Molecular import pattern:
 *   import { composeRetryLoopBundle } from './embedded-dags/ComposeRetryLoopDAG.ts';
 *   dispatcher.registerBundle(composeRetryLoopBundle);
 *
 * The sub-DAG operates on the parent's state directly (no projection / gather
 * needed); it reads `state.shortlist` / `state.intent` / `state.priorContext`
 * and writes `state.draft` / `state.approved`, which the parent DAG already
 * manages. Every intent branch funnels through this one composed loop rather
 * than each branch owning its own compose→validate chain.
 */

import type { ArchivistState }    from '../ArchivistState.ts';
import { composeResponse, validateResponse } from '../nodes/composeResponse.ts';
import { composeResponseSalvage } from '../nodes/salvage.ts';
import type { ArchivistServices } from '../services.ts';

import type { DAG, DispatcherBundle } from '@noocodex/dagonizer';
import { DAGBuilder } from '@noocodex/dagonizer/builder';


/**
 * The `compose-retry-loop` DAG: one packaged compose/validate unit that every
 * intent branch references via
 * `.embeddedDAG('compose-loop', 'compose-retry-loop', routes)`.
 *
 * Exits with `success` when the draft is approved or attempts are exhausted.
 * The parent DAG routes `compose-loop → success → respond-to-visitor` so
 * exactly ONE respond-to-visitor fires per run regardless of how many branches
 * converge into this sub-DAG.
 */
export const ComposeRetryLoopDAG: DAG = new DAGBuilder('compose-retry-loop', '1.1')

  // ── 1. compose-response ──────────────────────────────────────────────────
  // Writes state.draft via an intent-specific compose method. A transient LLM
  // failure routes 'retry' (loops back, bounded by the shared 'compose' budget)
  // or 'salvage' once spent; no in-node RetryPolicy. 'drafted' goes on to the
  // quality gate, which adds its own retry edge for low-quality drafts.
  .node('compose-response', composeResponse, {
    'drafted': 'validate-response',
    'retry':   'compose-response',
    'salvage': 'compose-salvage',
  })
  .node('compose-salvage', composeResponseSalvage, {
    'done': 'composed',
  })

  // ── 2. validate-response ─────────────────────────────────────────────────
  // Quality gate: length, citations, tone. On 'retry', routes back to
  // compose (bounded by MAX_COMPOSE_ATTEMPTS via state.retriesFor('compose')).
  // 'approved' and 'exhausted' both exit via the canonical `composed`
  // TerminalNode (completed), so the parent EmbeddedDAGNode resolves 'success'
  // and routes to respond-to-visitor.
  .node('validate-response', validateResponse, {
    'approved':  'composed',
    'retry':     'compose-response',
    'exhausted': 'composed',
  })

  // ── 3. composed ──────────────────────────────────────────────────────────
  // Canonical TerminalNode(completed): the single explicit exit of the compose
  // loop. No bare null end-of-flow routes.
  .terminal('composed', { outcome: 'completed' })

  .build();

/**
 * Bundle of every node used by `ComposeRetryLoopDAG` plus the DAG itself.
 * Register with `dispatcher.registerBundle(composeRetryLoopBundle)`.
 */
export const composeRetryLoopBundle: DispatcherBundle<ArchivistState, ArchivistServices> = {
  'nodes': [composeResponse, validateResponse, composeResponseSalvage],
  'dags': [ComposeRetryLoopDAG],
};
