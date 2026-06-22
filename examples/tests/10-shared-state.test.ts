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

describe('10-shared-state: MemoryStore shared across nodes via constructor injection', () => {
  it('entries accumulate in order: step-a, child-step, step-b', async () => {
    const logStore = new MemoryStore();
    const dispatcher = new Dagonizer<NodeStateBase>();

    dispatcher.registerNode(new StepANode(logStore));
    dispatcher.registerNode(new StepBNode(logStore));
    dispatcher.registerNode(new ChildStepNode(logStore));
    dispatcher.registerDAG(childDag);
    dispatcher.registerDAG(parentDag);

    const state = new NodeStateBase();
    const result = await dispatcher.execute('main-flow', state);

    assert.equal(result.terminalOutcome, 'completed');

    const rawEntries = await logStore.get('entries');
    const entries = typeof rawEntries === 'string' ? rawEntries : '';
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
    const dispatcher = new Dagonizer<NodeStateBase>();

    dispatcher.registerNode(new StepANode(logStore));
    dispatcher.registerNode(new StepBNode(logStore));
    dispatcher.registerNode(new ChildStepNode(logStore));
    dispatcher.registerDAG(childDag);
    dispatcher.registerDAG(parentDag);

    await dispatcher.execute('main-flow', new NodeStateBase());

    const rawEntries2 = await logStore.get('entries');
    const entries = typeof rawEntries2 === 'string' ? rawEntries2 : '';
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
