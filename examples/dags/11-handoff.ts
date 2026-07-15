/**
 * 11-handoff/dags: pure module — state, nodes, and DAG consts for both
 * DAG A (the producer) and DAG B (the consumer / continuation).
 * No side effects, no dispatcher, no execute.
 * Imported by examples/11-handoff.ts (the executable entry point).
 *
 * Architecture:
 *   DAG A accumulates a list of processed items and ends at a terminal
 *   named "handoff". The dispatcher is constructed with
 *     channels: { handoff: channel }
 *   so reaching that terminal publishes a DAGHandoff envelope.
 *   A channel subclass overrides the protected onPublished hook to restore
 *   the envelope state and run DAG B on a second dispatcher, completing the
 *   pipeline.
 *
 *   In production, the channel would send the envelope over a queue or
 *   event bus to a separate host. Here an InMemoryChannel stands in for
 *   the transport, demonstrating the envelope as the unit of cross-host
 *   state pass-over.
 */

import {
  Batch,
  DAG_CONTEXT,
  MonadicNode,
  NodeOutput,
  NodeStateBase,
  RoutedBatch,
} from '@studnicky/dagonizer';
import type { DAGType, SchemaObjectType } from '@studnicky/dagonizer';
import type { DAGHandoffType } from '@studnicky/dagonizer/entities';
import type { HandoffChannelInterface } from '@studnicky/dagonizer/contracts';

// ---------------------------------------------------------------------------
// Shared state: both DAGs operate on the same shape so the snapshot round-
// trip is transparent because the graph carries the domain fields.
// ---------------------------------------------------------------------------

// #region state
export class PipelineState extends NodeStateBase {
  items:   string[] = [];   // items accumulated by DAG A
  summary: string   = '';   // written by DAG B


}
// #endregion state

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

// DAG A: collect three items into state.items
// #region node-collect
export class CollectANode extends MonadicNode<PipelineState, 'done'> {
  readonly name = 'collectA';
  readonly '@id' = 'urn:noocodec:node:collectA';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<PipelineState>) {
    for (const item of batch) item.state.items.push('alpha');
    return RoutedBatch.create(NodeOutput.create('done').output, batch);
  }
}

export class CollectBNode extends MonadicNode<PipelineState, 'done'> {
  readonly name = 'collectB';
  readonly '@id' = 'urn:noocodec:node:collectB';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<PipelineState>) {
    for (const item of batch) item.state.items.push('beta');
    return RoutedBatch.create(NodeOutput.create('done').output, batch);
  }
}

export class CollectCNode extends MonadicNode<PipelineState, 'done'> {
  readonly name = 'collectC';
  readonly '@id' = 'urn:noocodec:node:collectC';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<PipelineState>) {
    for (const item of batch) item.state.items.push('gamma');
    return RoutedBatch.create(NodeOutput.create('done').output, batch);
  }
}
// #endregion node-collect

// DAG B: summarize the items collected by DAG A
// #region node-summarize
export class SummarizeNode extends MonadicNode<PipelineState, 'done'> {
  readonly name = 'summarize';
  readonly '@id' = 'urn:noocodec:node:summarize';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<PipelineState>) {
    for (const item of batch) {
      const state = item.state;
      state.summary = `processed ${state.items.length} item(s): ${state.items.join(', ')}`;
    }
    return RoutedBatch.create(NodeOutput.create('done').output, batch);
  }
}
// #endregion node-summarize

// ---------------------------------------------------------------------------
// DAG A: collect items then publish via the "handoff" terminal
// ---------------------------------------------------------------------------

// #region dag-a
export const dagA: DAGType = {
  '@context':  DAG_CONTEXT,
  '@id': 'urn:noocodec:dag:pipeline-a',
  '@type':     'DAG',
  "name":        'pipeline-a',
  "version":     '1',
  "entrypoints": { "main": 'urn:noocodec:dag:pipeline-a/node/step-a' },
  "nodes": [
    {
      '@id': 'urn:noocodec:dag:pipeline-a/node/step-a',
      '@type': 'SingleNode',
      "name":    'step-a',
      "node":    'urn:noocodec:node:collectA',
      "outputs": { "done": 'urn:noocodec:dag:pipeline-a/node/step-b' },
    },
    {
      '@id': 'urn:noocodec:dag:pipeline-a/node/step-b',
      '@type': 'SingleNode',
      "name":    'step-b',
      "node":    'urn:noocodec:node:collectB',
      "outputs": { "done": 'urn:noocodec:dag:pipeline-a/node/step-c' },
    },
    {
      '@id': 'urn:noocodec:dag:pipeline-a/node/step-c',
      '@type': 'SingleNode',
      "name":    'step-c',
      "node":    'urn:noocodec:node:collectC',
      "outputs": { "done": 'urn:noocodec:dag:pipeline-a/node/handoff' },
    },
    // Terminal named "handoff" — dispatcher publishes a DAGHandoff envelope
    // to the channel bound under this name.
    {
      '@id': 'urn:noocodec:dag:pipeline-a/node/handoff',
      '@type':   'TerminalNode',
      "name":    'handoff',
      "outcome": 'completed',
    },
  ],
};
// #endregion dag-a

// ---------------------------------------------------------------------------
// DAG B: summarize what DAG A collected
// ---------------------------------------------------------------------------

// #region dag-b
export const dagB: DAGType = {
  '@context':  DAG_CONTEXT,
  '@id': 'urn:noocodec:dag:pipeline-b',
  '@type':     'DAG',
  "name":        'pipeline-b',
  "version":     '1',
  "entrypoints": { "main": 'urn:noocodec:dag:pipeline-b/node/summarize' },
  "nodes": [
    {
      '@id': 'urn:noocodec:dag:pipeline-b/node/summarize',
      '@type': 'SingleNode',
      "name":    'summarize',
      "node":    'urn:noocodec:node:summarize',
      "outputs": { "done": 'urn:noocodec:dag:pipeline-b/node/end' },
    },
    {
      '@id': 'urn:noocodec:dag:pipeline-b/node/end',
      '@type':   'TerminalNode',
      "name":    'end',
      "outcome": 'completed',
    },
  ],
};
// #endregion dag-b

// ---------------------------------------------------------------------------
// Queue channel pattern: implement HandoffChannelInterface for a real transport
// ---------------------------------------------------------------------------

// #region queue-channel-pattern
/**
 * Skeleton for a real queue-backed channel. Replace the comment with an SDK
 * call (SQS, Pub/Sub, RabbitMQ, etc.). Never throw from publish; the
 * dispatcher catches all errors.
 */
export class QueueChannel implements HandoffChannelInterface {
  readonly published: DAGHandoffType[] = [];

  async publish(handoff: DAGHandoffType): Promise<void> {
    // await myQueueSdk.send(JSON.stringify(handoff));
    this.published.push(handoff);
  }
}
// #endregion queue-channel-pattern
