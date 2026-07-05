/**
 * serverless-handler/dags: pure module — a real in-process queue channel and a
 * serverless-style handler, both runnable with no cloud SDK.
 *
 * No side effects, no dispatcher, no execute. Imported by
 * examples/serverless-handler.ts (the executable entry point).
 *
 * The serverless pattern is envelope-in / envelope-out: a function receives a
 * DAGHandoff, restores state, runs a DAG to completion, and lets the bound
 * egress channels publish the next envelope. Here:
 *   - InMemoryQueueChannel implements HandoffChannelInterface against a real
 *     in-process array (the "queue"). Production swaps the array push for an
 *     SQS / Pub/Sub / RabbitMQ SDK call; the contract method is identical.
 *   - handle() is the function handler: verify version, restore state, build a
 *     per-invocation dispatcher with egress channels, execute. It is a plain
 *     Dagonizer instance — no Dagonizer-specific serverless runtime.
 */

import { Batch, DAG_CONTEXT, Dagonizer, MonadicNode, NodeOutputBuilder, NodeStateBase, RoutedBatchBuilder } from '@studnicky/dagonizer';
import type { DAGType, SchemaObjectType } from '@studnicky/dagonizer';
import type { HandoffChannelInterface } from '@studnicky/dagonizer/contracts';
import { JsonObject } from '@studnicky/dagonizer/entities';
import type { DAGHandoffType, JsonObjectType } from '@studnicky/dagonizer/entities';

export const REGISTRY_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// State carried across the hand-off boundary.
// ---------------------------------------------------------------------------

export class OrderState extends NodeStateBase {
  orderId = '';
  total = 0;
  status = 'pending';

  protected override snapshotData(): JsonObjectType {
    return { orderId: this.orderId, total: this.total, status: this.status };
  }

  protected override restoreData(snapshot: JsonObjectType): void {
    if (typeof snapshot['orderId'] === 'string') this.orderId = snapshot['orderId'];
    if (typeof snapshot['total'] === 'number') this.total = snapshot['total'];
    if (typeof snapshot['status'] === 'string') this.status = snapshot['status'];
  }
}

// ---------------------------------------------------------------------------
// The DAG the handler runs on each invocation: settle the order, then hand off.
// ---------------------------------------------------------------------------

export class SettleNode extends MonadicNode<OrderState, 'done'> {
  readonly name = 'settle';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }
  override async execute(batch: Batch<OrderState>) {
    for (const item of batch) item.state.status = 'settled';
    return RoutedBatchBuilder.of(NodeOutputBuilder.of('done').output, batch);
  }
}

export const settleDag: DAGType = {
  '@context': DAG_CONTEXT,
  '@id': 'urn:noocodex:dag:settle',
  '@type': 'DAG',
  name: 'settle',
  version: '1',
  entrypoint: 'settle',
  nodes: [
    {
      '@id': 'urn:noocodex:dag:settle/node/settle',
      '@type': 'SingleNode',
      name: 'settle',
      node: 'settle',
      outputs: { done: 'done' },
    },
    // Terminal "done" is bound to an egress channel; reaching it publishes the
    // next envelope.
    {
      '@id': 'urn:noocodex:dag:settle/node/done',
      '@type': 'TerminalNode',
      name: 'done',
      outcome: 'completed',
    },
  ],
};

// ---------------------------------------------------------------------------
// A REAL channel: in-process queue. Production replaces the array with an SDK.
// ---------------------------------------------------------------------------

// #region queue-channel
export class InMemoryQueueChannel implements HandoffChannelInterface {
  readonly #queue: DAGHandoffType[];

  constructor(queue: DAGHandoffType[]) {
    this.#queue = queue;
  }

  async publish(handoff: DAGHandoffType): Promise<void> {
    // Production: await sqsClient.send(new SendMessageCommand({ ... }));
    this.#queue.push(handoff);
  }
}
// #endregion queue-channel

// ---------------------------------------------------------------------------
// The serverless function handler: envelope-in / envelope-out.
// ---------------------------------------------------------------------------

// #region handler
export class ServerlessHandler {
  static async handle(
    envelope: DAGHandoffType,
    egress: HandoffChannelInterface,
  ): Promise<OrderState> {
    // 1. Verify version before executing.
    if (envelope.registryVersion !== REGISTRY_VERSION) {
      throw new Error(`Version mismatch: expected ${REGISTRY_VERSION}, got ${envelope.registryVersion}`);
    }

    // 2. Restore state. DAGHandoff is a oneOf: stateSnapshot (by-value) or
    //    stateSnapshotRef (by-reference URI). Narrow before restore.
    if (!('stateSnapshot' in envelope)) {
      throw new Error('stateSnapshotRef envelopes require fetching the URI before restore');
    }
    const snapshot: unknown = envelope.stateSnapshot;
    if (!JsonObject.is(snapshot)) {
      throw new Error('stateSnapshot is not a JSON object');
    }
    const state = OrderState.restore(snapshot);

    // 3. Build a per-invocation dispatcher with egress channels bound to terminal
    //    names. The channel publishes the next envelope after the terminal.
    const dispatcher = new Dagonizer<OrderState>({ channels: { done: egress } });
    dispatcher.registerNode(new SettleNode());
    dispatcher.registerDAG(settleDag);

    // 4. Execute. The dispatcher is constructed, used, and discarded per call.
    const result = await dispatcher.execute('settle', state);
    return result.state;
  }
}
// #endregion handler
