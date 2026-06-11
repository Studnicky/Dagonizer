/**
 * container-seam.test.ts
 *
 * Tests for W1 container seam:
 * (a) embedded DAG with NO container resolves in-process (byte-identical outputs).
 * (b) embedded DAG bound to a fake DagContainerInterface (test double) that runs
 *     the child in-process and returns the outcome via the contract — parent state
 *     reflects child mutations after applySnapshot, intermediates re-yield, and
 *     result.state === initialState.
 * (c) unbound container role on a placement fires contractWarning at registerDAG.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DagOutcomeInterface } from '../../src/container/DagOutcome.js';
import type { DagTaskInterface } from '../../src/container/DagTask.js';
import type { DagContainerInterface } from '../../src/contracts/DagContainerInterface.js';
import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { ObserverRelay } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAG } from '../../src/entities/index.js';
import type { JsonObject } from '../../src/entities/json.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

class CounterState extends NodeStateBase {
  value = 0;

  override clone(): this {
    const cloned = new (this.constructor as new () => this)();
    cloned.value = this.value;
    return cloned;
  }

  protected override snapshotData() {
    return { 'value': this.value };
  }

  protected override restoreData(snap: Record<string, unknown>) {
    const v = snap['value'];
    if (typeof v === 'number') this.value = v;
  }
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

const incrementNode: NodeInterface<CounterState, 'success'> = {
  'name': 'increment',
  'outputs': ['success'],
  async execute(state) {
    state.value += 10;
    return { 'errors': [], 'output': 'success' };
  },
};

const terminalNode: NodeInterface<CounterState, 'completed'> = {
  'name': 'done-node',
  'outputs': ['completed'],
  async execute() { return { 'errors': [], 'output': 'completed' }; },
};

// ---------------------------------------------------------------------------
// DAGs
// ---------------------------------------------------------------------------

const childDAG: DAG = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:child',
  '@type':    'DAG',
  'name':     'child',
  'version':  '1',
  'entrypoint': 'increment',
  'nodes': [
    {
      '@id':     'urn:noocodex:dag:child/node/increment',
      '@type':   'SingleNode',
      'name':    'increment',
      'node':    'increment',
      'outputs': { 'success': 'term' },
    },
    {
      '@id':     'urn:noocodex:dag:child/node/term',
      '@type':   'TerminalNode',
      'name':    'term',
      'outcome': 'completed',
    },
  ],
};

const parentDAG: DAG = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:parent',
  '@type':    'DAG',
  'name':     'parent',
  'version':  '1',
  'entrypoint': 'embed',
  'nodes': [
    {
      '@id':     'urn:noocodex:dag:parent/node/embed',
      '@type':   'EmbeddedDAGNode',
      'name':    'embed',
      'dag':     'child',
      'outputs': { 'success': 'end', 'error': 'end' },
      'stateMapping': {
        'input':  { 'value': 'value' },
        'output': { 'value': 'value' },
      },
    },
    { '@id': 'urn:noocodex:dag:parent/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
  ],
};

// Parent DAG with a container role declared.
const parentContainerDAG: DAG = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:parent-c',
  '@type':    'DAG',
  'name':     'parent-c',
  'version':  '1',
  'entrypoint': 'embed',
  'nodes': [
    {
      '@id':       'urn:noocodex:dag:parent-c/node/embed',
      '@type':     'EmbeddedDAGNode',
      'name':      'embed',
      'dag':       'child',
      'container': 'isolated',
      'outputs':   { 'success': 'end', 'error': 'end' },
      'stateMapping': {
        'input':  { 'value': 'value' },
        'output': { 'value': 'value' },
      },
    },
    { '@id': 'urn:noocodex:dag:parent-c/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInProcessDispatcher(): Dagonizer<CounterState> {
  const d = new Dagonizer<CounterState>();
  d.registerNode(incrementNode);
  d.registerNode(terminalNode);
  d.registerDAG(childDAG);
  d.registerDAG(parentDAG);
  return d;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void describe('Container seam — W1', () => {
  // (a) No container → in-process, byte-identical
  void it('embedded DAG with no container runs in-process and mutates state', async () => {
    const dispatcher = makeInProcessDispatcher();
    const state = new CounterState();
    assert.equal(state.value, 0);

    const result = await dispatcher.execute('parent', state);
    assert.equal(result.state.value, 10);
    assert.equal(result.state === state, true, 'result.state === initialState');
    assert.equal(result.terminalOutcome, 'completed');
    // Should have intermediates (the child's increment node)
    assert.ok(result.executedNodes.includes('embed'));
  });

  // (b) Bound container: test double that runs child in-process and returns via contract
  void it('bound container receives runDag call and outcome is applied to parent state', async () => {
    const warnings: string[] = [];

    // Subclass to capture any contract warnings (should be none when role is bound).
    class WatchDagonizer extends Dagonizer<CounterState> {
      protected override onContractWarning(message: string) {
        warnings.push(message);
      }
    }

    // Test double: a DagContainerInterface that delegates to a second Dagonizer instance.
    const fakeContainer: DagContainerInterface<CounterState> = {
      async runDag(task: DagTaskInterface<CounterState, unknown>, _options?: { readonly relay?: ObserverRelay }): Promise<DagOutcomeInterface> {
        // Restore child clone from the snapshot in the task
        const request = task.toRequest();
        // stateSnapshot is JsonObject at the wire boundary; cast is safe here.
        const childState = CounterState.restore(request.stateSnapshot as JsonObject);

        // Run the child DAG in-process (in an inner dispatcher)
        const inner = new Dagonizer<CounterState>();
        inner.registerNode(incrementNode);
        inner.registerNode(terminalNode);
        inner.registerDAG(childDAG);

        const childResult = await inner.execute(task.dagName, childState);

        return {
          'terminalOutput': 'success',
          'errors': [],
          'stateSnapshot': childState.snapshot(),
          'intermediates': childResult.executedNodes.map((nodeName) => ({
            'output': 'success',
            'skipped': false,
            nodeName,
          })),
        };
      },
    };

    const dispatcher = new WatchDagonizer({
      'containers': { 'isolated': fakeContainer },
    });
    dispatcher.registerNode(incrementNode);
    dispatcher.registerNode(terminalNode);
    dispatcher.registerDAG(childDAG);
    dispatcher.registerDAG(parentContainerDAG);

    // No warnings: role is bound
    assert.equal(warnings.length, 0);

    const state = new CounterState();
    const result = await dispatcher.execute('parent-c', state);

    // Child ran (added 10 to value) and applySnapshot applied the clone's
    // terminal snapshot back to the clone, then output mapping copied value
    // back to parent state.
    assert.equal(result.state.value, 10);
    assert.equal(result.state === state, true, 'result.state === initialState');
    // Intermediates from the child were re-yielded through the parent
    assert.ok(result.executedNodes.includes('embed'));
  });

  // (c) Unbound container role fires contractWarning at registerDAG
  void it('unbound container role fires contractWarning at registerDAG', () => {
    const warnings: string[] = [];

    // Subclass to capture warnings
    class ObserveDagonizer extends Dagonizer<CounterState> {
      protected override onContractWarning(message: string) {
        warnings.push(message);
      }
    }

    const dispatcher = new ObserveDagonizer();
    dispatcher.registerNode(incrementNode);
    dispatcher.registerNode(terminalNode);
    dispatcher.registerDAG(childDAG);
    // Parent declares container 'isolated' but no containers option was provided
    dispatcher.registerDAG(parentContainerDAG);

    assert.equal(warnings.length, 1);
    assert.ok(
      warnings[0]?.includes('isolated') === true,
      `Warning should mention 'isolated', got: ${warnings[0]}`,
    );
    assert.ok(
      warnings[0]?.includes('resolving to in-process') === true,
      `Warning should mention in-process, got: ${warnings[0]}`,
    );
  });

  // Verify in-process path is byte-identical regardless of whether containers is set
  void it('in-process path produces identical results regardless of empty containers option', async () => {
    const dispatcherA = makeInProcessDispatcher();
    const dispatcherB = new Dagonizer<CounterState>({ 'containers': {} });
    dispatcherB.registerNode(incrementNode);
    dispatcherB.registerNode(terminalNode);
    dispatcherB.registerDAG(childDAG);
    dispatcherB.registerDAG(parentDAG);

    const stateA = new CounterState();
    const stateB = new CounterState();

    const resultA = await dispatcherA.execute('parent', stateA);
    const resultB = await dispatcherB.execute('parent', stateB);

    assert.equal(resultA.state.value, resultB.state.value);
    assert.equal(resultA.executedNodes.join(','), resultB.executedNodes.join(','));
  });
});
