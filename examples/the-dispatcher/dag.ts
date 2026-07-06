/**
 * The Dispatcher: canonical DAG, built with DAGBuilder.
 *
 * Domain: Noocodex Support — customer support for a fictional bookstore.
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

import { DAGBuilder, PlaceholderNode } from '@studnicky/dagonizer';
import type { DAGType } from '@studnicky/dagonizer';

import type { DispatcherState } from './DispatcherState.ts';

// #region dispatcher-bundle

const setup           = new PlaceholderNode<DispatcherState, 'ready'>('dispatcher-setup', ['ready']);
const classifyMessage = new PlaceholderNode<DispatcherState, 'routine' | 'escalate' | 'off-topic'>('classify-message', ['routine', 'escalate', 'off-topic']);
const aiCompose       = new PlaceholderNode<DispatcherState, 'drafted'>('ai-compose', ['drafted']);
const parkForOperator = new PlaceholderNode<DispatcherState, 'parked' | 'ready'>('park-for-operator', ['parked', 'ready']);
const sendResponse    = new PlaceholderNode<DispatcherState, 'sent'>('send-response', ['sent']);
const decline         = new PlaceholderNode<DispatcherState, 'declined'>('decline', ['declined']);

export const supportDispatcherDAG: DAGType = new DAGBuilder('support-dispatcher', '1')
  // Pre-phase: stamps runId before the entrypoint runs.
  .phase('setup', 'pre', setup)

  // Entrypoint: classify the inbound message.
  .node('classify-message', classifyMessage, {
    'routine':   'ai-compose',
    'escalate':  'park-for-operator',
    'off-topic': 'decline',
  })

  // Routine branch: AI composes a canned reply -> send -> done.
  .node('ai-compose', aiCompose, {
    'drafted': 'send-response',
  })

  // Escalation branch: HITL suspension point.
  .node('park-for-operator', parkForOperator, {
    'parked': 'end',
    'ready':  'send-response',
  })

  // Shared convergence: both routine and escalated paths flow through send-response.
  .node('send-response', sendResponse, {
    'sent': 'end',
  })

  // Off-topic branch: decline and close.
  .node('decline', decline, {
    'declined': 'end',
  })

  .terminal('end', { 'outcome': 'completed' })

  .build();
// #endregion dispatcher-bundle
