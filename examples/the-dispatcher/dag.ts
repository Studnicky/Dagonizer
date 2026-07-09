/**
 * The Dispatcher: canonical DAG, built with DAGBuilder.
 *
 * Domain: Nocodec Support — customer support for a fictional bookstore.
 * Demonstrates the HITL park-and-correlate primitive with a trolley switch.
 *
 * Flow:
 *   [pre] setup ← stamps per-run metadata; never gates
 *
 *   classify-message
 *     → 'routine'   → ai-compose → send-response → end (completed)
 *     → 'escalate'  → park-for-operator
 *                        → 'ready'  → send-response → end (completed)
 *                        → 'parked' [engine intercepts; lifecycle → awaiting-input]
 *     → 'off-topic' → decline → end (completed)
 *
 * Trolley switch: state.humanMode = true forces 'escalate' on every message
 * regardless of content. Set externally before calling dispatcher.execute().
 *
 * HITL flow:
 *   1. Execute → parks (ParkForOperatorNode emits 'parked'; lifecycle →
 *      awaiting-input). result.parked carries correlationKey + cursor.
 *   2. Operator sets state.response externally.
 *   3. Checkpoint.capture + restore + dispatcher.resume(dagName, state, cursor).
 *   4. ParkForOperatorNode re-enters, sees response non-empty → routes 'ready'.
 *   5. send-response appends both sides to conversation → end.
 */

import { DAGBuilder, DAGIdentity, PlaceholderNode } from '@studnicky/dagonizer';
import type { DAGType } from '@studnicky/dagonizer';

import type { DispatcherState } from './DispatcherState.ts';

// #region dispatcher-bundle

const setup           = new PlaceholderNode<DispatcherState, 'ready'>('urn:noocodec:node:dispatcher-setup', ['ready']);
const classifyMessage = new PlaceholderNode<DispatcherState, 'routine' | 'escalate' | 'off-topic'>('urn:noocodec:node:classify-message', ['routine', 'escalate', 'off-topic']);
const aiCompose       = new PlaceholderNode<DispatcherState, 'drafted'>('urn:noocodec:node:ai-compose', ['drafted']);
const parkForOperator = new PlaceholderNode<DispatcherState, 'parked' | 'ready'>('urn:noocodec:node:park-for-operator', ['parked', 'ready']);
const sendResponse    = new PlaceholderNode<DispatcherState, 'sent'>('urn:noocodec:node:send-response', ['sent']);
const decline         = new PlaceholderNode<DispatcherState, 'declined'>('urn:noocodec:node:decline', ['declined']);

const supportDispatcherDagIri = 'urn:noocodec:dag:support-dispatcher' as const;
const placement = (placementIdentifier: string): string =>
  DAGIdentity.placementId(supportDispatcherDagIri, placementIdentifier);

export const supportDispatcherDAG: DAGType = new DAGBuilder(supportDispatcherDagIri, '1')
  // Pre-phase: stamps runId before the entrypoint runs.
  .phase(placement('setup'), 'pre', setup)

  // Entrypoint: classify the inbound message.
  .node(placement('classify-message'), classifyMessage, {
    'routine':   placement('ai-compose'),
    'escalate':  placement('park-for-operator'),
    'off-topic': placement('decline'),
  })

  // Routine branch: AI composes a canned reply -> send -> done.
  .node(placement('ai-compose'), aiCompose, {
    'drafted': placement('send-response'),
  })

  // Escalation branch: HITL suspension point.
  .node(placement('park-for-operator'), parkForOperator, {
    'parked': placement('end'),
    'ready':  placement('send-response'),
  })

  // Shared convergence: both routine and escalated paths flow through send-response.
  .node(placement('send-response'), sendResponse, {
    'sent': placement('end'),
  })

  // Off-topic branch: decline and close.
  .node(placement('decline'), decline, {
    'declined': placement('end'),
  })

  .terminal(placement('end'), { 'outcome': 'completed' })

  .build();
// #endregion dispatcher-bundle
