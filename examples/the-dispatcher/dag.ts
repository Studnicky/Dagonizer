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

import { DAGBuilder } from '@studnicky/dagonizer';
import type { DispatcherBundleType } from '@studnicky/dagonizer';

import type { DispatcherState } from './DispatcherState.ts';
import { AiComposeNode }        from './nodes/AiComposeNode.ts';
import { ClassifyMessageNode }  from './nodes/ClassifyMessageNode.ts';
import { DeclineNode }          from './nodes/DeclineNode.ts';
import { ParkForOperatorNode }  from './nodes/ParkForOperatorNode.ts';
import { SendResponseNode }     from './nodes/SendResponseNode.ts';
import { SetupNode }            from './nodes/SetupNode.ts';

// #region dispatcher-bundle
export class DispatcherBundleFactory {
  static create(): DispatcherBundleType<DispatcherState> {
    const setupNode          = new SetupNode();
    const classifyMessage    = new ClassifyMessageNode();
    const aiCompose          = new AiComposeNode();
    const parkForOperator    = new ParkForOperatorNode();
    const sendResponse       = new SendResponseNode();
    const decline            = new DeclineNode();

    const dag = new DAGBuilder('support-dispatcher', '1')
      // Pre-phase: stamps runId before the entrypoint runs.
      .phase('setup', 'pre', setupNode)

      // Entrypoint: classify the inbound message.
      .node('classify-message', classifyMessage, {
        'routine':   'ai-compose',
        'escalate':  'park-for-operator',
        'off-topic': 'decline',
      })

      // Routine branch: AI composes a canned reply → send → done.
      .node('ai-compose', aiCompose, {
        'drafted': 'send-response',
      })

      // Escalation branch: HITL suspension point.
      // 'parked' is mapped to 'end' to satisfy TypeScript route exhaustiveness,
      // but the engine intercepts 'parked' before routing — this target is never
      // reached. 'ready' means the operator replied; the flow continues to send-response.
      .node('park-for-operator', parkForOperator, {
        'parked': 'end',
        'ready':  'send-response',
      })

      // Shared convergence: both routine (ai-drafted) and escalated (operator)
      // paths flow through send-response before reaching the terminal.
      .node('send-response', sendResponse, {
        'sent': 'end',
      })

      // Off-topic branch: decline and close.
      .node('decline', decline, {
        'declined': 'end',
      })

      .terminal('end', { 'outcome': 'completed' })

      .build();

    return {
      'nodes': [
        setupNode,
        classifyMessage,
        aiCompose,
        parkForOperator,
        sendResponse,
        decline,
      ],
      'dags': [dag],
    };
  }
}
// #endregion dispatcher-bundle
