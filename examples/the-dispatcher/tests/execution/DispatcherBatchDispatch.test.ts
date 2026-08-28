import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Batch, Dagonizer } from '@studnicky/dagonizer';
import type {
  ItemType,
  NodeContextType,
  RoutedBatchType,
} from '@studnicky/dagonizer';

import { supportDispatcherDAG } from '../../dag.ts';
import { DispatcherState } from '../../DispatcherState.ts';
import { DispatcherBatchDispatch } from '../../execution/DispatcherBatchDispatch.ts';
import { AiComposeNode } from '../../nodes/AiComposeNode.ts';
import { ClassifyMessageNode } from '../../nodes/ClassifyMessageNode.ts';
import { DeclineNode } from '../../nodes/DeclineNode.ts';
import { ParkForOperatorNode } from '../../nodes/ParkForOperatorNode.ts';
import { ProvisionEmbedderNode } from '../../nodes/ProvisionEmbedderNode.ts';
import { SendResponseNode } from '../../nodes/SendResponseNode.ts';
import { SetupNode } from '../../nodes/SetupNode.ts';
import type {
  DispatcherIntentInterface,
  DispatcherLlmInterface,
  DispatcherServices,
} from '../../services.ts';

const DAG_NAME = supportDispatcherDAG['@id'];

class TestLlm implements DispatcherLlmInterface {
  classifyCallCount = 0;
  composeCallCount = 0;
  concurrentClassifyCalls = 0;
  maxConcurrentClassifyCalls = 0;

  async classify(message: string): Promise<'routine' | 'escalate' | 'off-topic'> {
    this.classifyCallCount++;
    this.concurrentClassifyCalls++;
    this.maxConcurrentClassifyCalls = Math.max(
      this.maxConcurrentClassifyCalls,
      this.concurrentClassifyCalls,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    this.concurrentClassifyCalls--;
    if (message.includes('ESCALATE')) return 'escalate';
    if (message.includes('OFFTOPIC')) return 'off-topic';
    return 'routine';
  }

  async compose(message: string): Promise<string> {
    this.composeCallCount++;
    await Promise.resolve();
    return `composed reply to: ${message}`;
  }

  async warm(): Promise<void> {
    await Promise.resolve();
  }
}

class UnexpectedIntentProvider {
  readonly displayName = null;

  async load(): Promise<DispatcherIntentInterface> {
    throw new Error('intent provider must not load in LLM mode');
  }
}

class RejectingIntentProvider {
  readonly displayName = null;

  async load(): Promise<DispatcherIntentInterface> {
    throw new Error('transformer model provisioning failed');
  }
}

function servicesFor(llm: TestLlm, concurrency: number): DispatcherServices {
  return { llm, 'intent': new UnexpectedIntentProvider(), 'execution': { concurrency } };
}

function dispatcherFor(
  services: DispatcherServices,
  classifyMessageNode: ClassifyMessageNode = new ClassifyMessageNode(services),
): Dagonizer<DispatcherState> {
  const dispatcher = new Dagonizer<DispatcherState>();
  dispatcher.registerBundle({
    'nodes': [
      new SetupNode(),
      new ProvisionEmbedderNode(services),
      classifyMessageNode,
      new AiComposeNode(services),
      new ParkForOperatorNode(),
      new SendResponseNode(),
      new DeclineNode(),
    ],
    'dags': [supportDispatcherDAG],
  });
  return dispatcher;
}

function itemOf(id: string, message: string): ItemType<DispatcherState> {
  const state = new DispatcherState();
  state.message = message;
  state.classificationMode = 'llm';
  return { id, state };
}

void describe('DispatcherBatchDispatch', () => {
  void it('partitions one mixed three-item scheduler workset', async () => {
    const llm = new TestLlm();
    const services = servicesFor(llm, 2);
    let classifyExecuteCalls = 0;
    let classifyBatchSize = 0;

    class ObservedClassifyMessageNode extends ClassifyMessageNode {
      override async execute(
        batch: Batch<DispatcherState>,
        context: NodeContextType,
      ): Promise<RoutedBatchType<'routine' | 'escalate' | 'off-topic', DispatcherState>> {
        classifyExecuteCalls++;
        classifyBatchSize = batch.size;
        return super.execute(batch, context);
      }
    }

    const dispatcher = dispatcherFor(services, new ObservedClassifyMessageNode(services));
    const routine = itemOf('routine', 'When does my order ship?');
    const offTopic = itemOf('off-topic', 'OFFTOPIC what is the weather?');
    const escalation = itemOf('escalation', 'ESCALATE connect me to an operator');

    const result = await DispatcherBatchDispatch.run(
      dispatcher,
      DAG_NAME,
      [routine, offTopic, escalation],
    );

    assert.equal(classifyExecuteCalls, 1);
    assert.equal(classifyBatchSize, 3);
    assert.equal(llm.classifyCallCount, 3);
    assert.deepEqual(result.completed, [routine, offTopic]);
    assert.deepEqual(result.failed, []);
    assert.deepEqual(result.awaitingInput, [escalation]);
    assert.equal(result.terminalOutcome, null);
    assert.equal(result.terminalOutcomeByItemId.get('routine'), 'completed');
    assert.equal(result.terminalOutcomeByItemId.get('off-topic'), 'completed');
    assert.deepEqual([...result.terminalOutcomeByItemId.keys()].sort(), ['off-topic', 'routine']);
    assert.equal(routine.state.lifecycle.variant, 'completed');
    assert.equal(offTopic.state.lifecycle.variant, 'completed');
    assert.equal(escalation.state.lifecycle.variant, 'awaiting-input');
  });

  void it('parks and resumes a size-one HITL workset through the real DAG', async () => {
    const llm = new TestLlm();
    const dispatcher = dispatcherFor(servicesFor(llm, 1));
    const escalation = itemOf('escalation', 'ESCALATE connect me to an operator');

    const parked = await DispatcherBatchDispatch.run(dispatcher, DAG_NAME, [escalation]);

    assert.deepEqual(parked.awaitingInput, [escalation]);
    if (parked.parked === null) {
      throw new Error('Expected the escalation workset to park');
    }
    assert.equal(parked.terminalOutcome, null);
    assert.equal(parked.terminalOutcomeByItemId.size, 0);

    escalation.state.response = 'An operator has resolved your request.';
    const resumed = await DispatcherBatchDispatch.resume(
      dispatcher,
      DAG_NAME,
      escalation,
      parked.parked.cursor,
    );

    assert.equal(resumed.terminalOutcome, 'completed');
    assert.deepEqual(resumed.completed, [escalation]);
    assert.deepEqual(resumed.failed, []);
    assert.deepEqual(resumed.awaitingInput, []);
    assert.equal(resumed.terminalOutcomeByItemId.get('escalation'), 'completed');
    assert.equal(escalation.state.lifecycle.variant, 'completed');
    assert.match(escalation.state.response, /operator has resolved/);
  });

  void it('places explicit embedder provisioning rejection in the failed partition', async () => {
    const llm = new TestLlm();
    const services: DispatcherServices = {
      llm,
      'intent': new RejectingIntentProvider(),
      'execution': { 'concurrency': 1 },
    };
    const dispatcher = dispatcherFor(services);
    const failedItem = itemOf('failed', 'Where is my package?');
    failedItem.state.classificationMode = 'embedder';

    const result = await DispatcherBatchDispatch.run(dispatcher, DAG_NAME, [failedItem]);

    assert.deepEqual(result.completed, []);
    assert.deepEqual(result.failed, [failedItem]);
    assert.deepEqual(result.awaitingInput, []);
    assert.equal(result.terminalOutcome, 'failed');
    assert.equal(result.terminalOutcomeByItemId.get('failed'), 'failed');
    assert.equal(failedItem.state.lifecycle.variant, 'failed');
  });

  void it('bounds node-local item work independently of scheduler workset size', async () => {
    const llm = new TestLlm();
    const dispatcher = dispatcherFor(servicesFor(llm, 2));
    const items = [
      itemOf('one', 'Where is my package?'),
      itemOf('two', 'What is your return policy?'),
      itemOf('three', 'OFFTOPIC do you sell cars?'),
      itemOf('four', 'When does my order ship?'),
    ];

    const result = await DispatcherBatchDispatch.run(dispatcher, DAG_NAME, items);

    assert.equal(result.completed.length, 4);
    assert.equal(llm.classifyCallCount, 4);
    assert.equal(llm.maxConcurrentClassifyCalls, 2);
  });
});
