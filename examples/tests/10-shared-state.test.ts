import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Dagonizer, NodeStateBase } from '@studnicky/dagonizer';
import {
  StepANode,
  StepBNode,
  ChildStepNode,
  childDag,
  parentDag,
  MemoryStore,
} from '../dags/10-shared-state.ts';
import type { Services } from '../dags/10-shared-state.ts';

describe('10-shared-state: MemoryStore shared across nodes via services bag', () => {
  it('entries accumulate in order: step-a, child-step, step-b', async () => {
    const logStore = new MemoryStore();
    const dispatcher = new Dagonizer<NodeStateBase, Services>({ services: { log: logStore } });

    dispatcher.registerNode(new StepANode());
    dispatcher.registerNode(new StepBNode());
    dispatcher.registerNode(new ChildStepNode());
    dispatcher.registerDAG(childDag);
    dispatcher.registerDAG(parentDag);

    const state = new NodeStateBase();
    const result = await dispatcher.execute('main-flow', state);

    assert.equal(result.terminalOutcome, 'completed');

    const entries = await logStore.get<string>('entries') ?? '';
    assert.ok(
      entries.includes('step-a'),
      `Expected entries to include "step-a" but got: "${entries}"`,
    );
    assert.ok(
      entries.includes('child-step'),
      `Expected entries to include "child-step" but got: "${entries}"`,
    );
    assert.ok(
      entries.includes('step-b'),
      `Expected entries to include "step-b" but got: "${entries}"`,
    );
  });

  it('entries appear in step-a → child-step → step-b order', async () => {
    const logStore = new MemoryStore();
    const dispatcher = new Dagonizer<NodeStateBase, Services>({ services: { log: logStore } });

    dispatcher.registerNode(new StepANode());
    dispatcher.registerNode(new StepBNode());
    dispatcher.registerNode(new ChildStepNode());
    dispatcher.registerDAG(childDag);
    dispatcher.registerDAG(parentDag);

    await dispatcher.execute('main-flow', new NodeStateBase());

    const entries = await logStore.get<string>('entries') ?? '';
    const parts = entries.split(',').filter(Boolean);

    const indexA = parts.indexOf('step-a');
    const indexChild = parts.indexOf('child-step');
    const indexB = parts.indexOf('step-b');

    assert.ok(indexA !== -1, 'step-a not in entries');
    assert.ok(indexChild !== -1, 'child-step not in entries');
    assert.ok(indexB !== -1, 'step-b not in entries');
    assert.ok(indexA < indexChild, 'step-a should appear before child-step');
    assert.ok(indexChild < indexB, 'child-step should appear before step-b');
  });
});
