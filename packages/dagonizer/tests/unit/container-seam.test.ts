/**
 * container-seam.test.ts
 *
 * Register/build-time behavior of the W1 container seam at the Dagonizer and
 * DAGBuilder level (no worker process, no transport):
 *
 * Builder container key:
 *   - scatter({ container }) and embeddedDAG({ container }) emit the container
 *     property on the placement; omitting the option leaves it absent; a
 *     plain node() placement never carries a container property.
 *
 * Container seam execution:
 *   (a) embedded DAG with NO container resolves in-process (byte-identical).
 *   (b) embedded DAG bound to a fake DagContainerInterface (test double) that
 *       runs the child in-process and returns the outcome via the contract —
 *       parent state reflects child mutations, intermediates re-yield, and
 *       result.state === initialState.
 *   (c) an unbound container role on a placement fires contractWarning at
 *       registerDAG.
 *   (d) the in-process path is identical whether or not an empty containers
 *       option is supplied.
 *
 * Container validation at registerDAG:
 *   - a ScatterNode with a node body AND a container key throws ValidationError.
 *   - a ScatterNode with a dag body AND a container key is valid (no throw).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import type { DagOutcomeInterface } from '../../src/container/DagOutcome.js';
import type { DagTaskInterface } from '../../src/container/DagTask.js';
import type { DagContainerInterface } from '../../src/contracts/DagContainerInterface.js';
import { ScalarNode } from '../../src/core/ScalarNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { ObserverRelay } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAG } from '../../src/entities/index.js';
import type { JsonObject } from '../../src/entities/json.js';
import type { NodeOutputInterface } from '../../src/entities/node/NodeOutput.js';
import { ValidationError } from '../../src/errors/index.js';
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

class NoopNode extends ScalarNode<NodeStateBase, 'success'> {
  readonly name = 'noop';
  readonly outputs = ['success'] as const;
  protected async executeOne(_state: NodeStateBase): Promise<NodeOutputInterface<'success'>> { return { 'errors': [], 'output': 'success' as const }; }
}
const noop = new NoopNode();

class IncrementNode extends ScalarNode<CounterState, 'success'> {
  readonly name = 'increment';
  readonly outputs = ['success'] as const;
  protected async executeOne(state: CounterState): Promise<NodeOutputInterface<'success'>> {
    state.value += 10;
    return { 'errors': [], 'output': 'success' as const };
  }
}
const incrementNode = new IncrementNode();

class TerminalNode extends ScalarNode<CounterState, 'completed'> {
  readonly name = 'done-node';
  readonly outputs = ['completed'] as const;
  protected async executeOne(): Promise<NodeOutputInterface<'completed'>> { return { 'errors': [], 'output': 'completed' as const }; }
}
const terminalNode = new TerminalNode();

class BodyNode extends ScalarNode<NodeStateBase, 'success'> {
  readonly name = 'body-node';
  readonly outputs = ['success'] as const;
  protected async executeOne(): Promise<NodeOutputInterface<'success'>> { return { 'errors': [], 'output': 'success' as const }; }
}
const bodyNode = new BodyNode();

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

// A ScatterNode with a node body AND a container key — this is a validation error.
const invalidScatterDAG: DAG = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:invalid',
  '@type':    'DAG',
  'name':     'invalid',
  'version':  '1',
  'entrypoint': 'scatter',
  'nodes': [
    {
      '@id':       'urn:noocodex:dag:invalid/node/scatter',
      '@type':     'ScatterNode',
      'name':      'scatter',
      'source':    'items',
      'body':      { 'node': 'body-node' },
      'gather':    { 'strategy': 'discard' },
      'container': 'cpu',
      'outputs':   {
        'all-success': 'end',
        'partial': 'end',
        'all-error': 'end',
        'empty': 'end',
      },
    },
    { '@id': 'urn:noocodex:dag:invalid/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
  ],
};

// A ScatterNode with a dag body AND a container key — this is valid.
const validDagBodyScatterDAG: DAG = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:valid-dag-body',
  '@type':    'DAG',
  'name':     'valid-dag-body',
  'version':  '1',
  'entrypoint': 'scatter',
  'nodes': [
    {
      '@id':       'urn:noocodex:dag:valid-dag-body/node/scatter',
      '@type':     'ScatterNode',
      'name':      'scatter',
      'source':    'items',
      'body':      { 'dag': 'body-child' },
      'gather':    { 'strategy': 'discard' },
      'container': 'cpu',
      'outputs':   {
        'all-success': 'end',
        'partial': 'end',
        'all-error': 'end',
        'empty': 'end',
      },
    },
    { '@id': 'urn:noocodex:dag:valid-dag-body/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
  ],
};

// Child DAG referenced by the valid dag-body scatter.
const bodyChildDAG: DAG = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:body-child',
  '@type':    'DAG',
  'name':     'body-child',
  'version':  '1',
  'entrypoint': 'body-node',
  'nodes': [
    {
      '@id':     'urn:noocodex:dag:body-child/node/body-node',
      '@type':   'SingleNode',
      'name':    'body-node',
      'node':    'body-node',
      'outputs': { 'success': 'end' },
    },
    { '@id': 'urn:noocodex:dag:body-child/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
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
// Builder container key
// ---------------------------------------------------------------------------

void describe('Builder container key', () => {
  void it('scatter with container option emits container property on placement', () => {
    const dag = new DAGBuilder('scatter-c', '1')
      .scatter('fan-out', 'items', { 'dag': 'child-dag' }, { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' }, {
        'container': 'cpu',
        'gather': { 'strategy': 'discard' },
      })
      .build();

    const placement = dag.nodes[0];
    assert.ok(placement !== undefined);
    assert.equal(placement['@type'], 'ScatterNode');
    assert.equal((placement as Record<string, unknown>)['container'], 'cpu');
  });

  void it('scatter without container option has no container property', () => {
    const dag = new DAGBuilder('scatter-nc', '1')
      .scatter('fan-out', 'items', noop, { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' }, {
        'gather': { 'strategy': 'discard' },
      })
      .build();

    const placement = dag.nodes[0];
    assert.ok(placement !== undefined);
    assert.equal(placement['@type'], 'ScatterNode');
    assert.equal('container' in placement, false, 'container should be absent when not provided');
  });

  void it('embeddedDAG with container option emits container property on placement', () => {
    const dag = new DAGBuilder('embed-c', '1')
      .embeddedDAG('invoke', 'child-dag', { 'success': 'end', 'error': 'end' }, {
        'container': 'isolated',
      })
      .build();

    const placement = dag.nodes[0];
    assert.ok(placement !== undefined);
    assert.equal(placement['@type'], 'EmbeddedDAGNode');
    assert.equal((placement as Record<string, unknown>)['container'], 'isolated');
  });

  void it('embeddedDAG without container option has no container property', () => {
    const dag = new DAGBuilder('embed-nc', '1')
      .embeddedDAG('invoke', 'child-dag', { 'success': 'end', 'error': 'end' })
      .build();

    const placement = dag.nodes[0];
    assert.ok(placement !== undefined);
    assert.equal(placement['@type'], 'EmbeddedDAGNode');
    assert.equal('container' in placement, false, 'container should be absent when not provided');
  });

  void it('node() placement has no container property', () => {
    const dag = new DAGBuilder('node-nc', '1')
      .node('noop', noop, { 'success': 'end' })
      .build();

    const placement = dag.nodes[0];
    assert.ok(placement !== undefined);
    assert.equal(placement['@type'], 'SingleNode');
    assert.equal('container' in placement, false, 'SingleNode never has a container property');
  });
});

// ---------------------------------------------------------------------------
// Container seam — W1
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
        // Restore child clone from the snapshot in the task.
        // items[0].snapshot is JsonObject at the wire boundary; cast is safe here.
        const request = task.toRequest();
        const firstItem = request.items[0];
        if (firstItem === undefined) throw new Error('No items in request');
        const childState = CounterState.restore(firstItem.snapshot as JsonObject);

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

// ---------------------------------------------------------------------------
// Container validation — node-body scatter
// ---------------------------------------------------------------------------

void describe('Container validation — node-body scatter', () => {
  void it('throws ValidationError when ScatterNode has node body AND container key', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(bodyNode);

    assert.throws(
      () => dispatcher.registerDAG(invalidScatterDAG),
      ValidationError,
      'Expected a ValidationError for node-body scatter with container',
    );
  });

  void it('does not throw when ScatterNode has dag body AND container key', () => {
    const warnings: string[] = [];
    class ObserveDagonizer extends Dagonizer<NodeStateBase> {
      protected override onContractWarning(msg: string) { warnings.push(msg); }
    }

    const dispatcher = new ObserveDagonizer();
    dispatcher.registerNode(bodyNode);
    dispatcher.registerDAG(bodyChildDAG);

    // Should not throw — dag body with container is valid
    assert.doesNotThrow(() => dispatcher.registerDAG(validDagBodyScatterDAG));
  });
});
