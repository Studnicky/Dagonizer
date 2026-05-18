/**
 * ComposeRetryLoopDAG — reusable compose / validate / retry loop.
 *
 * Internal flow:
 *
 *   crl-compose-response
 *     └─ drafted ──► crl-validate-response
 *          ├─ approved  ──► END (success) ─► parent: respond-to-visitor
 *          ├─ retry     ──► crl-compose-response   (bounded by state.attempts.compose)
 *          └─ exhausted ──► END (success) ─► parent: respond-to-visitor
 *
 * Outputs:
 *   success — draft composed (approved or best-effort); parent routes to
 *             the shared respond-to-visitor terminal.
 *   error   — child-state errors accumulated (propagated by executeSubDAG)
 *
 * Fan-in policy: this sub-DAG does NOT contain respondToVisitor. It is a
 * pure compose/validate unit that produces state.draft and exits. The
 * single shared respond-to-visitor placement lives at the parent DAG level
 * so that every converging branch strikes exactly one terminal node per run.
 *
 * Molecular import pattern:
 *   import { ComposeRetryLoopDAG, registerComposeRetryLoopNodes } from './subdags/ComposeRetryLoopDAG.ts';
 *   registerComposeRetryLoopNodes(dispatcher);
 *   dispatcher.registerDAG(ComposeRetryLoopDAG);
 *
 * The sub-DAG operates on the parent's state directly (no stateMapping
 * needed) — it reads `state.shortlist` / `state.intent` / `state.priorContext`
 * and writes `state.draft` / `state.approved`, which the parent DAG already
 * manages. Every intent branch funnels through this one composed loop rather
 * than each branch owning its own compose→validate chain.
 */

import type { ArchivistState }    from '../ArchivistState.ts';
import { composeResponse, validateResponse } from '../nodes/composeResponse.ts';
import type { ArchivistServices } from '../services.ts';

import type { Dagonizer } from '@noocodex/dagonizer';
import { DAGBuilder } from '@noocodex/dagonizer/builder';
import type { DAG } from '@noocodex/dagonizer/entities';


/**
 * The `compose-retry-loop` DAG — one packaged compose/validate unit that every
 * intent branch references via `.subDAG('compose-loop', 'compose-retry-loop', routes)`.
 *
 * Exits with `success` when the draft is approved or attempts are exhausted.
 * The parent DAG routes `compose-loop → success → respond-to-visitor` so
 * exactly ONE respond-to-visitor fires per run regardless of how many branches
 * converge into this sub-DAG.
 */
export const ComposeRetryLoopDAG: DAG = new DAGBuilder('compose-retry-loop', '1.1')

  // ── 1. compose-response ──────────────────────────────────────────────────
  // LLM call wrapped with RetryPolicy for transient failures. Writes
  // state.draft. Intent-specific compose methods dispatched inside the node
  // via state.intent switch.
  .node('crl-compose-response', composeResponse, {
    'drafted': 'crl-validate-response',
  })

  // ── 2. validate-response ─────────────────────────────────────────────────
  // Quality gate: length, citations, tone. On 'retry', routes back to
  // compose (bounded by MAX_COMPOSE_ATTEMPTS on state.attempts.compose).
  // 'approved' and 'exhausted' both exit the sub-DAG cleanly (null terminal)
  // so the parent receives output 'success' and routes to respond-to-visitor.
  .node('crl-validate-response', validateResponse, {
    'approved':  null,
    'retry':     'crl-compose-response',
    'exhausted': null,
  })

  .build();

/**
 * Register all nodes used by `ComposeRetryLoopDAG` onto a dispatcher.
 *
 * Call this before `dispatcher.registerDAG(ComposeRetryLoopDAG)`. Accepts
 * any `Dagonizer`-compatible dispatcher to allow consumers to use their
 * own subclass while still pulling in the molecular node set.
 *
 * @example
 * ```ts
 * registerComposeRetryLoopNodes(dispatcher);
 * dispatcher.registerDAG(ComposeRetryLoopDAG);
 * ```
 */
export function registerComposeRetryLoopNodes(
  dispatcher: Dagonizer<ArchivistState, ArchivistServices>,
): void {
  for (const node of [
    composeResponse,
    validateResponse,
  ]) {
    dispatcher.registerNode(node);
  }
}
