/**
 * ComposeRetryLoopDAG — reusable compose / validate / retry loop.
 *
 * Internal flow:
 *
 *   crl-compose-response
 *     └─ drafted ──► crl-validate-response
 *          ├─ approved  ──► crl-respond-to-visitor ──► END (success)
 *          ├─ retry     ──► crl-compose-response   (bounded by state.attempts.compose)
 *          └─ exhausted ──► crl-respond-to-visitor ──► END (success)
 *
 * Outputs:
 *   success — response was composed and delivered (approved or best-effort)
 *   error   — child-state errors accumulated (propagated by executeSubDAG)
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
 * than each branch owning its own compose→validate→terminal chain.
 */

import type { ArchivistState }    from '../ArchivistState.ts';
import { composeResponse, validateResponse } from '../nodes/composeResponse.ts';
import { respondToVisitor }                  from '../nodes/respondToVisitor.ts';
import type { ArchivistServices } from '../services.ts';

import type { Dagonizer } from '@noocodex/dagonizer';
import { DAGBuilder } from '@noocodex/dagonizer/builder';
import type { DAG } from '@noocodex/dagonizer/entities';


/**
 * The `compose-retry-loop` DAG — one packaged terminal unit that every
 * intent branch references via `.subDAG('compose-loop', 'compose-retry-loop', routes)`.
 */
export const ComposeRetryLoopDAG: DAG = new DAGBuilder('compose-retry-loop', '1.0')

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
  // 'exhausted' sends the best-effort draft to the visitor — the dispatcher
  // never throws on exhaustion.
  .node('crl-validate-response', validateResponse, {
    'approved':  'crl-respond-to-visitor',
    'retry':     'crl-compose-response',
    'exhausted': 'crl-respond-to-visitor',
  })

  // ── 3. respond-to-visitor ────────────────────────────────────────────────
  // Terminal node: writes state.draft to the conversation, emits 'success'.
  // Sub-DAG exits cleanly — parent receives output 'success'.
  .node('crl-respond-to-visitor', respondToVisitor, {
    'success': null,
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
    respondToVisitor,
  ]) {
    dispatcher.registerNode(node);
  }
}
