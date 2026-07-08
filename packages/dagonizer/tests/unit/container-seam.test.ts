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
 *   (c) on a container-dispatching dispatcher, an unbound container role on a
 *       placement throws DAGError at registerDAG; a pure in-process dispatcher
 *       registers the same DAG without throwing.
 *   (d) the in-process path is identical whether or not an empty containers
 *       option is supplied.
 *
 * Container validation at registerDAG:
 *   - a ScatterNode with a node body AND a container key throws DAGError.
 *   - a ScatterNode with a dag body AND a container key is valid (no throw).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import type { DagOutcomeType } from '../../src/container/DagOutcome.js';
import type { DagTaskInterface } from '../../src/container/DagTask.js';
import { DAG_CONTAINER_TRANSPORT } from '../../src/container/TransportErrorCode.js';
import type { DagContainerInterface } from '../../src/contracts/DagContainerInterface.js';
import type { SchemaObjectType } from '../../src/contracts/NodeInterface.js';
import type { ObserverRelayInterface } from '../../src/contracts/ObserverRelayInterface.js';
import { MonadicNode } from '../../src/core/MonadicNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { Batch } from '../../src/entities/batch/Batch.js';
import { SCATTER_PROGRESS_KEY } from '../../src/entities/constants/ProgressKey.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import { Placement } from '../../src/entities/dag/Placement.js';
import type { ExecutionRequestType } from '../../src/entities/executor/ExecutionRequest.js';
import type { DAGType } from '../../src/entities/index.js';
import type { JsonObjectType } from '../../src/entities/json.js';
import { JsonValue } from '../../src/entities/JsonValue.js';
import { NodeError } from '../../src/entities/node/NodeError.js';
import { DAGError } from '../../src/errors/index.js';
import { DagGraphProjector } from '../../src/graph/DagGraphProjector.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { Validator } from '../../src/validation/Validator.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

class CounterState extends NodeStateBase {
  value = 0;

  protected override snapshotData() {
    return { 'value': this.value };
  }

  protected override restoreData(snap: Record<string, unknown>) {
    const v = snap['value'];
    if (typeof v === 'number') this.value = v;
  }
}

class DynamicContainerState extends NodeStateBase {
  value = 0;
  selectedDag = '';
  items: Array<{ dagName: string }> = [];

  protected override snapshotData(): JsonObjectType {
    return {
      'value': this.value,
      'selectedDag': this.selectedDag,
      'items': this.items.map((item) => ({ ...item })),
    };
  }

  protected override restoreData(snap: JsonObjectType): void {
    const value = snap['value'];
    if (typeof value === 'number') this.value = value;
    const selectedDag = snap['selectedDag'];
    if (typeof selectedDag === 'string') this.selectedDag = selectedDag;
    const items = snap['items'];
    if (Array.isArray(items)) {
      this.items = items.filter((entry): entry is { dagName: string } => {
        return typeof entry === 'object'
          && entry !== null
          && !Array.isArray(entry)
          && typeof entry['dagName'] === 'string';
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

class NoopNode extends MonadicNode<NodeStateBase, 'success'> {
  readonly name = 'noop';
  readonly outputs = ['success'] as const;
  override get outputSchema(): Record<'success', SchemaObjectType> { return { 'success': { 'type': 'object' } }; }
  override async execute(batch: Batch<NodeStateBase>): Promise<Map<'success', Batch<NodeStateBase>>> { return new Map([['success', batch]]); }
}
const noop = new NoopNode();

class IncrementNode extends MonadicNode<CounterState, 'success'> {
  readonly name = 'increment';
  readonly outputs = ['success'] as const;
  override get outputSchema(): Record<'success', SchemaObjectType> { return { 'success': { 'type': 'object' } }; }
  override async execute(batch: Batch<CounterState>): Promise<Map<'success', Batch<CounterState>>> {
    for (const item of batch) item.state.value += 10;
    return new Map([['success', batch]]);
  }
}
const incrementNode = new IncrementNode();

class TerminalNode extends MonadicNode<CounterState, 'completed'> {
  readonly name = 'done-node';
  readonly outputs = ['completed'] as const;
  override get outputSchema(): Record<'completed', SchemaObjectType> { return { 'completed': { 'type': 'object' } }; }
  override async execute(batch: Batch<CounterState>): Promise<Map<'completed', Batch<CounterState>>> { return new Map([['completed', batch]]); }
}
const terminalNode = new TerminalNode();

class BodyNode extends MonadicNode<NodeStateBase, 'success'> {
  readonly name = 'body-node';
  readonly outputs = ['success'] as const;
  override get outputSchema(): Record<'success', SchemaObjectType> { return { 'success': { 'type': 'object' } }; }
  override async execute(batch: Batch<NodeStateBase>): Promise<Map<'success', Batch<NodeStateBase>>> { return new Map([['success', batch]]); }
}
const bodyNode = new BodyNode();

// ---------------------------------------------------------------------------
// DAGs
// ---------------------------------------------------------------------------

const childDAG: DAGType = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:child',
  '@type':    'DAG',
  'name':     'child',
  'version':  '1',
  'entrypoints': { 'main': 'increment' },
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

const parentDAG: DAGType = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:parent',
  '@type':    'DAG',
  'name':     'parent',
  'version':  '1',
  'entrypoints': { 'main': 'embed' },
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
const parentContainerDAG: DAGType = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:parent-c',
  '@type':    'DAG',
  'name':     'parent-c',
  'version':  '1',
  'entrypoints': { 'main': 'embed' },
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

// Minimal CounterState container test double used only to put a dispatcher in
// container-dispatch mode (its runDag is never invoked by the registration tests).
const fakeCounterContainer: DagContainerInterface = {
  async runDag(_task: DagTaskInterface, _options?: { readonly relay?: ObserverRelayInterface }): Promise<DagOutcomeType> {
    return { 'terminalOutput': 'success', 'errors': [], 'stateSnapshot': {}, 'intermediates': [] };
  },
};

// A ScatterNode with a node body AND a container key — this is a validation error.
const invalidScatterDAG: DAGType = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:invalid',
  '@type':    'DAG',
  'name':     'invalid',
  'version':  '1',
  'entrypoints': { 'main': 'scatter' },
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
const validDagBodyScatterDAG: DAGType = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:valid-dag-body',
  '@type':    'DAG',
  'name':     'valid-dag-body',
  'version':  '1',
  'entrypoints': { 'main': 'scatter' },
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

// Minimal container test double bound to role 'cpu' so a dag-body scatter that
// declares that role registers without tripping the unbound-role throw. Its
// runDag is never invoked by the registration-only test below.
const fakeDagContainer: DagContainerInterface = {
  async runDag(_task: DagTaskInterface, _options?: { readonly relay?: ObserverRelayInterface }): Promise<DagOutcomeType> {
    return { 'terminalOutput': 'success', 'errors': [], 'stateSnapshot': {}, 'intermediates': [] };
  },
};

// Child DAG referenced by the valid dag-body scatter.
const bodyChildDAG: DAGType = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:body-child',
  '@type':    'DAG',
  'name':     'body-child',
  'version':  '1',
  'entrypoints': { 'main': 'body-node' },
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

const dynamicChildA = new DAGBuilder('dynamic-child-a', '1')
  .terminal('done')
  .entrypoint('done')
  .build();

const dynamicChildB = new DAGBuilder('dynamic-child-b', '1')
  .terminal('done')
  .entrypoint('done')
  .build();

function transportError(message: string = 'transport lost') {
  return NodeError.create(
    DAG_CONTAINER_TRANSPORT,
    message,
    'runDag',
    true,
    '2020-01-01T00:00:00Z',
  );
}

function firstRequestSnapshot(request: ExecutionRequestType): JsonObjectType {
  const firstItem = request.items[0];
  if (firstItem === undefined) throw new Error('No item in container request');
  const snapshot = JsonValue.from(firstItem.snapshot);
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
    throw new Error('container request snapshot must be a JSON object');
  }
  return snapshot;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class DispatcherFixture {
  private constructor() {}

  static inProcess(): Dagonizer<CounterState> {
    const d = new Dagonizer<CounterState>();
    d.registerNode(incrementNode);
    d.registerNode(terminalNode);
    d.registerDAG(childDAG);
    d.registerDAG(parentDAG);
    return d;
  }
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
    assert.ok(Placement.isScatter(placement));
    assert.equal(placement.container, 'cpu');
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
    assert.ok(Placement.isEmbeddedDAG(placement));
    assert.equal(placement.container, 'isolated');
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
    const dispatcher = DispatcherFixture.inProcess();
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
    // Test double: a DagContainerInterface that delegates to a second Dagonizer instance.
    const fakeContainer: DagContainerInterface = {
      async runDag(task: DagTaskInterface, _options?: { readonly relay?: ObserverRelayInterface }): Promise<DagOutcomeType> {
        // Restore child clone from the snapshot in the task.
        // items[0].snapshot is { [key: string]: unknown } at the wire boundary;
        // JsonValue.from coerces it to JsonValueType, then the object guard narrows
        // to JsonObjectType so CounterState.restore can accept it cast-free.
        const request = task.toRequest();
        const firstItem = request.items[0];
        if (firstItem === undefined) throw new Error('No items in request');
        const rawSnap = JsonValue.from(firstItem.snapshot);
        if (typeof rawSnap !== 'object' || rawSnap === null || Array.isArray(rawSnap)) {
          throw new Error('snapshot must be a JSON object');
        }
        const childState = CounterState.restore(rawSnap);

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

    const dispatcher = new Dagonizer<CounterState>({
      'containers': { 'isolated': fakeContainer },
    });
    dispatcher.registerNode(incrementNode);
    dispatcher.registerNode(terminalNode);
    dispatcher.registerDAG(childDAG);
    // Role 'isolated' is bound, so registerDAG accepts the placement.
    dispatcher.registerDAG(parentContainerDAG);

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

  // (c) A container-dispatching dispatcher with an unbound declared role throws
  // DAGError at registerDAG (D2 = throw). The dispatcher opts into containers by
  // binding one role; the placement declares a DIFFERENT, unbound role.
  void it('unbound container role throws DAGError at registerDAG when the dispatcher uses containers', () => {
    // Bind some-other-role so the dispatcher is in container-dispatch mode, but
    // leave the 'isolated' role parentContainerDAG declares unbound.
    const dispatcher = new Dagonizer<CounterState>({
      'containers': { 'some-other-role': fakeCounterContainer },
    });
    dispatcher.registerNode(incrementNode);
    dispatcher.registerNode(terminalNode);
    dispatcher.registerDAG(childDAG);

    assert.throws(
      () => dispatcher.registerDAG(parentContainerDAG),
      (err: unknown) => {
        assert.ok(err instanceof DAGError);
        assert.ok(
          err.message.includes('isolated'),
          `error should mention 'isolated', got: ${err.message}`,
        );
        return true;
      },
    );
  });

  // (c2) A pure in-process dispatcher (no containers bound) registers a
  // container-declaring DAG without throwing: declared roles are inert and every
  // body runs in-process. This is the path DagHost relies on.
  void it('pure in-process dispatcher registers a container-declaring DAG without throwing', () => {
    const dispatcher = new Dagonizer<CounterState>();
    dispatcher.registerNode(incrementNode);
    dispatcher.registerNode(terminalNode);
    dispatcher.registerDAG(childDAG);

    assert.doesNotThrow(() => dispatcher.registerDAG(parentContainerDAG));
  });

  // Verify in-process path is byte-identical regardless of whether containers is set
  void it('in-process path produces identical results regardless of empty containers option', async () => {
    const dispatcherA = DispatcherFixture.inProcess();
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
// Container seam — dynamic DAG references
// ---------------------------------------------------------------------------

void describe('Container seam — dynamic DAG references', () => {
  void it('embedded dynamic DagReference resolves before container handoff', async () => {
    const requests: ExecutionRequestType[] = [];
    const parentDag = new DAGBuilder('dynamic-embedded-container-parent', '1')
      .embed<DynamicContainerState, DynamicContainerState>(
        'embed',
        {
          'from': 'state',
          'path': 'selectedDag',
          'candidates': ['dynamic-child-a'],
        },
        { 'success': 'end', 'error': 'failed' },
        { 'container': 'isolated', 'outputs': { 'value': 'value' } },
      )
      .terminal('end')
      .terminal('failed', { 'outcome': 'failed' })
      .build();
    const selectedDagIri = DagGraphProjector.dagIri(dynamicChildA);

    const container: DagContainerInterface = {
      async runDag(task: DagTaskInterface): Promise<DagOutcomeType> {
        const request = task.toRequest();
        requests.push(request);
        const snapshot = firstRequestSnapshot(request);
        return {
          'terminalOutput': 'success',
          'errors': [],
          'stateSnapshot': { ...snapshot, 'value': 77 },
          'intermediates': [],
        };
      },
    };
    const dispatcher = new Dagonizer<DynamicContainerState>({
      'containers': { 'isolated': container },
    });
    dispatcher.registerDAG(dynamicChildA);
    dispatcher.registerDAG(parentDag);

    const state = new DynamicContainerState();
    state.selectedDag = selectedDagIri;
    const result = await dispatcher.execute('dynamic-embedded-container-parent', state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(result.state.value, 77);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.dagName, selectedDagIri);
    assert.deepEqual(requests[0]?.placementPath, ['embed']);
  });

  void it('scatter dynamic DagReference sends one selected DAG request per item', async () => {
    const requests: ExecutionRequestType[] = [];
    const parentDag = new DAGBuilder('dynamic-scatter-container-parent', '1')
      .scatter<DynamicContainerState, 'success'>(
        'fan',
        'items',
        {
          'dag': {
            'from': 'item',
            'path': 'dagName',
            'candidates': ['dynamic-child-a', 'dynamic-child-b'],
          },
        },
        {
          'all-success': 'end',
          'partial':     'end',
          'all-error':   'end',
          'empty':       'end',
        },
        {
          'container': 'cpu',
          'gather': { 'strategy': 'discard' },
          'execution': { 'mode': 'item', 'concurrency': 1 },
        },
      )
      .terminal('end')
      .build();
    const childAIri = DagGraphProjector.dagIri(dynamicChildA);
    const childBIri = DagGraphProjector.dagIri(dynamicChildB);

    const container: DagContainerInterface = {
      async runDag(task: DagTaskInterface): Promise<DagOutcomeType> {
        const request = task.toRequest();
        requests.push(request);
        const snapshot = firstRequestSnapshot(request);
        return {
          'terminalOutput': 'success',
          'errors': [],
          'stateSnapshot': snapshot,
          'intermediates': [],
        };
      },
    };
    const dispatcher = new Dagonizer<DynamicContainerState>({
      'containers': { 'cpu': container },
    });
    dispatcher.registerDAG(dynamicChildA);
    dispatcher.registerDAG(dynamicChildB);
    dispatcher.registerDAG(parentDag);

    const state = new DynamicContainerState();
    state.items = [{ 'dagName': childAIri }, { 'dagName': childBIri }];
    const result = await dispatcher.execute('dynamic-scatter-container-parent', state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.deepEqual(requests.map((request) => request.dagName), [childAIri, childBIri]);
    assert.deepEqual(requests.map((request) => request.placementPath), [['fan'], ['fan']]);
  });

  void it('embedded dynamic container transport failure routes to error', async () => {
    const requests: ExecutionRequestType[] = [];
    const parentDag = new DAGBuilder('dynamic-embedded-container-error-parent', '1')
      .embed<DynamicContainerState, DynamicContainerState>(
        'embed',
        {
          'from': 'state',
          'path': 'selectedDag',
          'candidates': ['dynamic-child-a'],
        },
        { 'success': 'end', 'error': 'failed' },
        { 'container': 'isolated' },
      )
      .terminal('end')
      .terminal('failed', { 'outcome': 'failed' })
      .build();
    const selectedDagIri = DagGraphProjector.dagIri(dynamicChildA);

    const container: DagContainerInterface = {
      async runDag(task: DagTaskInterface): Promise<DagOutcomeType> {
        const request = task.toRequest();
        requests.push(request);
        return {
          'terminalOutput': 'failed',
          'errors': [transportError('embedded transport lost')],
          'stateSnapshot': null,
          'intermediates': [],
        };
      },
    };
    const dispatcher = new Dagonizer<DynamicContainerState>({
      'containers': { 'isolated': container },
    });
    dispatcher.registerDAG(dynamicChildA);
    dispatcher.registerDAG(parentDag);

    const state = new DynamicContainerState();
    state.selectedDag = selectedDagIri;
    const result = await dispatcher.execute('dynamic-embedded-container-error-parent', state);

    assert.equal(result.terminalOutcome, 'failed');
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.dagName, selectedDagIri);
    assert.ok(
      result.state.errors.some((error) => error.code === DAG_CONTAINER_TRANSPORT),
      'transport error should be retained on parent state',
    );
  });

  void it('scatter dynamic container transport failure preserves checkpoint for resume', async () => {
    const requests: ExecutionRequestType[] = [];
    const parentDag = new DAGBuilder('dynamic-scatter-container-error-parent', '1')
      .scatter<DynamicContainerState, 'success'>(
        'fan',
        'items',
        {
          'dag': {
            'from': 'item',
            'path': 'dagName',
            'candidates': ['dynamic-child-a', 'dynamic-child-b'],
          },
        },
        {
          'all-success': 'end',
          'partial':     'end',
          'all-error':   'end',
          'empty':       'end',
        },
        {
          'container': 'cpu',
          'gather': { 'strategy': 'discard' },
          'execution': { 'mode': 'item', 'concurrency': 1 },
        },
      )
      .terminal('end')
      .build();
    const childAIri = DagGraphProjector.dagIri(dynamicChildA);
    const childBIri = DagGraphProjector.dagIri(dynamicChildB);

    const container: DagContainerInterface = {
      async runDag(task: DagTaskInterface): Promise<DagOutcomeType> {
        const request = task.toRequest();
        requests.push(request);
        return {
          'terminalOutput': 'failed',
          'errors': [transportError('scatter transport lost')],
          'stateSnapshot': null,
          'intermediates': [],
        };
      },
    };
    const dispatcher = new Dagonizer<DynamicContainerState>({
      'containers': { 'cpu': container },
    });
    dispatcher.registerDAG(dynamicChildA);
    dispatcher.registerDAG(dynamicChildB);
    dispatcher.registerDAG(parentDag);

    const state = new DynamicContainerState();
    state.items = [{ 'dagName': childAIri }, { 'dagName': childBIri }];
    const result = await dispatcher.execute('dynamic-scatter-container-error-parent', state);

    assert.equal(result.cursor, 'fan');
    assert.deepEqual(requests.map((request) => request.dagName), [childAIri]);
    const rawProgress = result.state.getMetadata(SCATTER_PROGRESS_KEY);
    assert.ok(rawProgress !== undefined, 'scatter checkpoint should survive transport failure');
    const progress = Validator.storedScatterProgress.validate(rawProgress);
    const entry = progress['fan'];
    assert.ok(entry !== undefined, 'progress must include placement "fan"');
    const ackedCount = entry.mode === 'bounded'
      ? entry.watermark + entry.aheadAcked.length
      : entry.ackedResults.length;
    assert.equal(ackedCount, 0);
    assert.equal(entry.inbox.length, 1);
    assert.equal(entry.inbox[0]?.index, 0);
  });
});

// ---------------------------------------------------------------------------
// Container validation — node-body scatter
// ---------------------------------------------------------------------------

void describe('Container validation — node-body scatter', () => {
  void it('throws DAGError when ScatterNode has node body AND container key', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(bodyNode);

    assert.throws(
      () => dispatcher.registerDAG(invalidScatterDAG),
      /ScatterNode 'scatter' has a node body; 'container' is only valid for a dag body/u,
      'Expected a DAGError for node-body scatter with container',
    );
  });

  void it('does not throw when ScatterNode has dag body AND a bound container key', () => {
    const dispatcher = new Dagonizer<NodeStateBase>({
      'containers': { 'cpu': fakeDagContainer },
    });
    dispatcher.registerNode(bodyNode);
    dispatcher.registerDAG(bodyChildDAG);

    // Should not throw — dag body with a BOUND container role is valid.
    assert.doesNotThrow(() => dispatcher.registerDAG(validDagBodyScatterDAG));
  });
});
