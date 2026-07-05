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

import { DAGBuilder, MonadicNode, PlaceholderNode } from '@studnicky/dagonizer';
import type { DAGType, DispatcherBundleType } from '@studnicky/dagonizer';

import type { DispatcherState } from './DispatcherState.ts';
import type { DispatcherServices } from './services.ts';
import { AiComposeNode }        from './nodes/AiComposeNode.ts';
import { ClassifyMessageNode }  from './nodes/ClassifyMessageNode.ts';
import { DeclineNode }          from './nodes/DeclineNode.ts';
import { ParkForOperatorNode }  from './nodes/ParkForOperatorNode.ts';
import { SendResponseNode }     from './nodes/SendResponseNode.ts';
import { SetupNode }            from './nodes/SetupNode.ts';

// #region dispatcher-bundle

interface DispatcherNodeBundle {
  readonly setup:           MonadicNode<DispatcherState, 'ready'>;
  readonly classifyMessage: MonadicNode<DispatcherState, 'routine' | 'escalate' | 'off-topic'>;
  readonly aiCompose:       MonadicNode<DispatcherState, 'drafted'>;
  readonly parkForOperator: MonadicNode<DispatcherState, 'parked' | 'ready'>;
  readonly sendResponse:    MonadicNode<DispatcherState, 'sent'>;
  readonly decline:         MonadicNode<DispatcherState, 'declined'>;
}

export class DispatcherBundleFactory {
  /**
   * Single source of the topology: wiring, routes, phase, terminal — declared once.
   * Both create() (real nodes, for execution) and structure() (placeholder nodes,
   * for display) flow through this method, so the displayed graph and the executed
   * graph can never drift.
   */
  private static assemble(nodes: DispatcherNodeBundle): DAGType {
    return new DAGBuilder('support-dispatcher', '1')
      // Pre-phase: stamps runId before the entrypoint runs.
      .phase('setup', 'pre', nodes.setup)

      // Entrypoint: classify the inbound message.
      .node('classify-message', nodes.classifyMessage, {
        'routine':   'ai-compose',
        'escalate':  'park-for-operator',
        'off-topic': 'decline',
      })

      // Routine branch: AI composes a canned reply → send → done.
      .node('ai-compose', nodes.aiCompose, {
        'drafted': 'send-response',
      })

      // Escalation branch: HITL suspension point.
      // 'parked' is mapped to 'end' to satisfy TypeScript route exhaustiveness,
      // but the engine intercepts 'parked' before routing — this target is never
      // reached. 'ready' means the operator replied; the flow continues to send-response.
      .node('park-for-operator', nodes.parkForOperator, {
        'parked': 'end',
        'ready':  'send-response',
      })

      // Shared convergence: both routine (ai-drafted) and escalated (operator)
      // paths flow through send-response before reaching the terminal.
      .node('send-response', nodes.sendResponse, {
        'sent': 'end',
      })

      // Off-topic branch: decline and close.
      .node('decline', nodes.decline, {
        'declined': 'end',
      })

      .terminal('end', { 'outcome': 'completed' })

      .build();
  }

  static create(services: DispatcherServices): DispatcherBundleType<DispatcherState> {
    const setup           = new SetupNode();
    const classifyMessage = new ClassifyMessageNode(services);
    const aiCompose       = new AiComposeNode(services);
    const parkForOperator = new ParkForOperatorNode();
    const sendResponse    = new SendResponseNode();
    const decline         = new DeclineNode();

    const dag = DispatcherBundleFactory.assemble({
      setup, classifyMessage, aiCompose, parkForOperator, sendResponse, decline,
    });

    return {
      'nodes': [setup, classifyMessage, aiCompose, parkForOperator, sendResponse, decline],
      'dags':  [dag],
    };
  }

  /**
   * Service-free DAG of identical topology, for rendering the graph before (and
   * independent of) any LLM backend selection. PlaceholderNode stubs satisfy the
   * builder's per-port routing contract without running any business logic.
   */
  static structure(): DAGType {
    return DispatcherBundleFactory.assemble({
      'setup':           new PlaceholderNode<DispatcherState, 'ready'>('setup', ['ready']),
      'classifyMessage': new PlaceholderNode<DispatcherState, 'routine' | 'escalate' | 'off-topic'>('classify-message', ['routine', 'escalate', 'off-topic']),
      'aiCompose':       new PlaceholderNode<DispatcherState, 'drafted'>('ai-compose', ['drafted']),
      'parkForOperator': new PlaceholderNode<DispatcherState, 'parked' | 'ready'>('park-for-operator', ['parked', 'ready']),
      'sendResponse':    new PlaceholderNode<DispatcherState, 'sent'>('send-response', ['sent']),
      'decline':         new PlaceholderNode<DispatcherState, 'declined'>('decline', ['declined']),
    });
  }
}
// #endregion dispatcher-bundle
