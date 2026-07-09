import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { OutcomeRecordType } from '../../src/contracts/OutcomeRecord.js';
import {
  GatherStrategies,
  GatherStrategy,
  OutcomeReducer,
  OutcomeReducers,
} from '../../src/core/index.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAGType } from '../../src/entities/index.js';
import type { NodeStateInterface } from '../../src/NodeStateBase.js';
import { TestNode } from '../_support/TestNode.js';

const testDagIri = (segment: string): string => `urn:noocodec:dag:${segment}`;
const testPlacementIri = (dagIri: string, segment: string): string => `${dagIri}/node/${segment}`;

void describe('GatherStrategies registry', () => {
  afterEach(() => { GatherStrategies.reset(); });

  void it('lists default strategies on first import', () => {
    const names = GatherStrategies.list();
    assert.ok(names.includes('map'));
    assert.ok(names.includes('append'));
    assert.ok(names.includes('partition'));
    assert.ok(names.includes('custom'));
  });

  void it('resolves a default strategy by name', () => {
    const strategy = GatherStrategies.resolve('append');
    assert.equal(strategy.name, 'append');
  });

  void it('throws for an unknown strategy name', () => {
    assert.throws(() => GatherStrategies.resolve('top-n'));
  });

  void it('custom strategy class extends and registers', () => {
    class TopOneGather extends GatherStrategy {
      readonly name = 'top-one';
      readonly '@id' = 'urn:noocodec:node:top-one';
      reduce(): void { /* no-op for registry test */ }
    }
    GatherStrategies.register(new TopOneGather());
    const strategy = GatherStrategies.resolve('top-one');
    assert.equal(strategy.name, 'top-one');
  });

  void it('unregister removes the named strategy; resolve throws afterward', () => {
    class TempGather extends GatherStrategy {
      readonly name = 'temp-gather';
      readonly '@id' = 'urn:noocodec:node:temp-gather';
      reduce(): void { /* no-op */ }
    }
    GatherStrategies.register(new TempGather());
    assert.equal(GatherStrategies.resolve('temp-gather').name, 'temp-gather');
    GatherStrategies.unregister('temp-gather');
    assert.throws(() => GatherStrategies.resolve('temp-gather'));
  });

  void it('reset restores only the built-in strategies', () => {
    class ExtraGather extends GatherStrategy {
      readonly name = 'extra';
      readonly '@id' = 'urn:noocodec:node:extra';
      reduce(): void { /* no-op */ }
    }
    GatherStrategies.register(new ExtraGather());
    assert.ok(GatherStrategies.list().includes('extra'));
    GatherStrategies.reset();
    assert.ok(!GatherStrategies.list().includes('extra'), 'extra must be gone after reset');
    assert.ok(GatherStrategies.list().includes('map'), 'built-ins must survive reset');
  });

  void it('register throws when the name is already registered', () => {
    class DupeGather extends GatherStrategy {
      readonly name = 'dupe-gather';
      readonly '@id' = 'urn:noocodec:node:dupe-gather';
      reduce(): void { /* no-op */ }
    }
    GatherStrategies.register(new DupeGather());
    assert.throws(
      () => GatherStrategies.register(new DupeGather()),
      /already registered/,
    );
  });

  void it('replace() overwrites an existing registration without throwing', () => {
    class V1Gather extends GatherStrategy {
      readonly name = 'v-gather';
      readonly '@id' = 'urn:noocodec:node:v-gather';
      reduce(): void { /* v1 */ }
    }
    class V2Gather extends GatherStrategy {
      readonly name = 'v-gather';
      readonly '@id' = 'urn:noocodec:node:v-gather';
      reduce(): void { /* v2 */ }
    }
    GatherStrategies.register(new V1Gather());
    // replace() must NOT throw
    GatherStrategies.replace(new V2Gather());
    const resolved = GatherStrategies.resolve('v-gather');
    assert.ok(resolved instanceof V2Gather, 'replace must install V2');
  });
});

void describe('OutcomeReducers registry', () => {
  afterEach(() => { OutcomeReducers.reset(); });

  void it('lists default reducers on first import', () => {
    const names = OutcomeReducers.list();
    assert.ok(names.includes('aggregate'));
    assert.ok(names.includes('terminal'));
  });

  void it('resolves a default reducer by name', () => {
    const reducer = OutcomeReducers.resolve('aggregate');
    assert.equal(reducer.name, 'aggregate');
  });

  void it('throws for an unknown reducer name', () => {
    assert.throws(() => OutcomeReducers.resolve('threshold-75'));
  });

  void it('aggregate reducer: empty → "empty"', () => {
    const reducer = OutcomeReducers.resolve('aggregate');
    assert.equal(reducer.reduce([]), 'empty');
  });

  void it('aggregate reducer: all success → "all-success"', () => {
    const reducer = OutcomeReducers.resolve('aggregate');
    const records: OutcomeRecordType[] = [
      { 'index': 0, 'output': 'success', 'terminalOutcome': null },
      { 'index': 1, 'output': 'success', 'terminalOutcome': null },
    ];
    assert.equal(reducer.reduce(records), 'all-success');
  });

  void it('aggregate reducer: no success → "all-error"', () => {
    const reducer = OutcomeReducers.resolve('aggregate');
    const records: OutcomeRecordType[] = [
      { 'index': 0, 'output': 'error', 'terminalOutcome': null },
      { 'index': 1, 'output': 'error', 'terminalOutcome': null },
    ];
    assert.equal(reducer.reduce(records), 'all-error');
  });

  void it('aggregate reducer: mixed → "partial"', () => {
    const reducer = OutcomeReducers.resolve('aggregate');
    const records: OutcomeRecordType[] = [
      { 'index': 0, 'output': 'success', 'terminalOutcome': null },
      { 'index': 1, 'output': 'error',   'terminalOutcome': null },
    ];
    assert.equal(reducer.reduce(records), 'partial');
  });

  void it('terminal reducer: success output → "success"', () => {
    const reducer = OutcomeReducers.resolve('terminal');
    const records: OutcomeRecordType[] = [
      { 'index': 0, 'output': 'success', 'terminalOutcome': null },
    ];
    assert.equal(reducer.reduce(records), 'success');
  });

  void it('terminal reducer: error output → "error"', () => {
    const reducer = OutcomeReducers.resolve('terminal');
    const records: OutcomeRecordType[] = [
      { 'index': 0, 'output': 'error', 'terminalOutcome': null },
    ];
    assert.equal(reducer.reduce(records), 'error');
  });

  void it('terminal reducer: failed terminalOutcome → "error"', () => {
    const reducer = OutcomeReducers.resolve('terminal');
    const records: OutcomeRecordType[] = [
      { 'index': 0, 'output': 'success', 'terminalOutcome': 'failed' },
    ];
    assert.equal(reducer.reduce(records), 'error');
  });

  void it('terminal reducer: empty records → "error"', () => {
    const reducer = OutcomeReducers.resolve('terminal');
    assert.equal(reducer.reduce([]), 'error');
  });

  void it('register installs a custom reducer that resolves by name', () => {
    class ThresholdReducer extends OutcomeReducer {
      readonly name = 'threshold-75';
      readonly '@id' = 'urn:noocodec:node:threshold-75';
      reduce(records: ReadonlyArray<OutcomeRecordType>): string {
        const successRate = records.filter((r) => r.output === 'success').length / records.length;
        return successRate >= 0.75 ? 'all-success' : 'partial';
      }
    }
    OutcomeReducers.register(new ThresholdReducer());
    const reducer = OutcomeReducers.resolve('threshold-75');
    assert.equal(reducer.name, 'threshold-75');
    const records: OutcomeRecordType[] = [
      { 'index': 0, 'output': 'success', 'terminalOutcome': null },
      { 'index': 1, 'output': 'success', 'terminalOutcome': null },
      { 'index': 2, 'output': 'success', 'terminalOutcome': null },
      { 'index': 3, 'output': 'error',   'terminalOutcome': null },
    ];
    assert.equal(reducer.reduce(records), 'all-success');
  });

  void it('unregister removes the named reducer; resolve throws afterward', () => {
    class TempReducer extends OutcomeReducer {
      readonly name = 'temp-reducer';
      readonly '@id' = 'urn:noocodec:node:temp-reducer';
      reduce(): string { return 'done'; }
    }
    OutcomeReducers.register(new TempReducer());
    assert.equal(OutcomeReducers.resolve('temp-reducer').name, 'temp-reducer');
    OutcomeReducers.unregister('temp-reducer');
    assert.throws(() => OutcomeReducers.resolve('temp-reducer'));
  });

  void it('reset restores only the built-in reducers', () => {
    class ExtraReducer extends OutcomeReducer {
      readonly name = 'extra-reducer';
      readonly '@id' = 'urn:noocodec:node:extra-reducer';
      reduce(): string { return 'done'; }
    }
    OutcomeReducers.register(new ExtraReducer());
    assert.ok(OutcomeReducers.list().includes('extra-reducer'));
    OutcomeReducers.reset();
    assert.ok(!OutcomeReducers.list().includes('extra-reducer'), 'extra must be gone after reset');
    assert.ok(OutcomeReducers.list().includes('aggregate'), 'built-ins must survive reset');
  });

  void it('register throws when the name is already registered', () => {
    class DupeReducer extends OutcomeReducer {
      readonly name = 'dupe-reducer';
      readonly '@id' = 'urn:noocodec:node:dupe-reducer';
      reduce(): string { return 'done'; }
    }
    OutcomeReducers.register(new DupeReducer());
    assert.throws(
      () => OutcomeReducers.register(new DupeReducer()),
      /already registered/,
    );
  });

  void it('replace() overwrites an existing registration without throwing', () => {
    class V1Reducer extends OutcomeReducer {
      readonly name = 'v-reducer';
      readonly '@id' = 'urn:noocodec:node:v-reducer';
      reduce(): string { return 'v1'; }
    }
    class V2Reducer extends OutcomeReducer {
      readonly name = 'v-reducer';
      readonly '@id' = 'urn:noocodec:node:v-reducer';
      reduce(): string { return 'v2'; }
    }
    OutcomeReducers.register(new V1Reducer());
    // replace() must NOT throw
    OutcomeReducers.replace(new V2Reducer());
    const resolved = OutcomeReducers.resolve('v-reducer');
    assert.ok(resolved instanceof V2Reducer, 'replace must install V2');
  });
});

void describe('Dagonizer.getDAG / listDAGs / getNode / listNodes', () => {
  void it('returns undefined for missing registry references', () => {
    const dispatcher = new Dagonizer<NodeStateInterface>();
    assert.equal(dispatcher.getDAG('nope'), undefined);
    assert.equal(dispatcher.getNode('urn:noocodec:node:nope'), undefined);
    assert.deepEqual(dispatcher.listDAGs(), []);
    assert.deepEqual(dispatcher.listNodes(), []);
  });

  void it('snapshots return registered DAGs and nodes', () => {
    const dispatcher = new Dagonizer<NodeStateInterface>();
    const node = TestNode.make('urn:noocodec:node:greet', ['done'], () => 'done');
    dispatcher.registerNode(node);
    const dagIri = testDagIri('demo');
    const greetIri = testPlacementIri(dagIri, 'greet');
    const endIri = testPlacementIri(dagIri, 'end');
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id': dagIri,
      '@type':    'DAG',
      'name': 'demo',
      'version': '1',
      'entrypoints': { 'main': greetIri },
      'nodes': [{
        '@id': greetIri,
        '@type': 'SingleNode',
        'name':  'greet', 'node': 'urn:noocodec:node:greet', 'outputs': { 'done': endIri },
      },
        { '@id': endIri, '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    dispatcher.registerDAG(dag);

    assert.equal(dispatcher.getNode('urn:noocodec:node:greet'), node);
    assert.equal(dispatcher.getDAG(dagIri), dag);
    assert.deepEqual(dispatcher.listNodes(), [node]);
    assert.deepEqual(dispatcher.listDAGs(), [dag]);
    assert.equal(dispatcher.getDAG(dagIri) !== undefined, true);
    assert.equal(dispatcher.getNode('urn:noocodec:node:greet') !== undefined, true);
    assert.deepEqual(dispatcher.dagIris(), [dagIri]);
    assert.deepEqual(dispatcher.nodeIris(), ['urn:noocodec:node:greet']);
  });

  void it('list snapshots are independent of the registry', () => {
    const dispatcher = new Dagonizer<NodeStateInterface>();
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:a', ['done'], () => 'done'));
    const before = dispatcher.listNodes();
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:b', ['done'], () => 'done'));
    assert.equal(before.length, 1);
    assert.equal(dispatcher.listNodes().length, 2);
  });

  // No shared state: each test creates its own Dagonizer instance.
});

class TestRegistryDag {
  private constructor() {}

  static singleNode(dagName: string, nodeName: string): DAGType {
    const dagIri = testDagIri(dagName);
    const nodeIri = testPlacementIri(dagIri, nodeName);
    const endIri = testPlacementIri(dagIri, 'end');
    return {
      '@context': DAG_CONTEXT,
      '@id': dagIri,
      '@type': 'DAG',
      'name': dagName,
      'version': '1',
      'entrypoints': { 'main': nodeIri },
      'nodes': [{
        '@id': nodeIri,
        '@type': 'SingleNode',
        'name': nodeName,
        'node': `urn:noocodec:node:${nodeName}`,
        'outputs': { 'done': endIri },
      },
        { '@id': endIri, '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
  }

  static terminalOnly(dagName: string): DAGType {
    const dagIri = testDagIri(dagName);
    const endIri = testPlacementIri(dagIri, 'end');
    return {
      '@context': DAG_CONTEXT,
      '@id': dagIri,
      '@type': 'DAG',
      'name': dagName,
      'version': '1',
      'entrypoints': { 'main': endIri },
      'nodes': [
        { '@id': endIri, '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
  }

  static embedded(dagName: string, placementName: string, childDag: string, outputs?: Record<string, string>): DAGType {
    const dagIri = testDagIri(dagName);
    const placementIri = testPlacementIri(dagIri, placementName);
    const endIri = testPlacementIri(dagIri, 'end');
    return {
      '@context': DAG_CONTEXT,
      '@id': dagIri,
      '@type': 'DAG',
      'name': dagName,
      'version': '1',
      'entrypoints': { 'main': placementIri },
      'nodes': [{
        '@id': placementIri,
        '@type': 'EmbeddedDAGNode',
        'name': placementName,
        'dag': childDag,
        'outputs': outputs ?? { 'success': endIri, 'error': endIri },
      },
        { '@id': endIri, '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
  }

  static recursiveNoExit(dagName: string, placementName: string, childDag: string): DAGType {
    const dagIri = testDagIri(dagName);
    const placementIri = testPlacementIri(dagIri, placementName);
    return {
      '@context': DAG_CONTEXT,
      '@id': dagIri,
      '@type': 'DAG',
      'name': dagName,
      'version': '1',
      'entrypoints': { 'main': placementIri },
      'nodes': [{
        '@id': placementIri,
        '@type': 'EmbeddedDAGNode',
        'name': placementName,
        'dag': childDag,
        'outputs': { 'success': placementIri, 'error': placementIri },
      }],
    };
  }
}

void describe('Dagonizer.registerBundle', () => {
  void it('registers every node then every DAG from the bundle', () => {
    const dispatcher = new Dagonizer<NodeStateInterface>();
    const nodeA = TestNode.make('urn:noocodec:node:a', ['done'], () => 'done');
    const nodeB = TestNode.make('urn:noocodec:node:b', ['done'], () => 'done');
    const dagA = TestRegistryDag.singleNode('flowA', 'a');
    const dagB = TestRegistryDag.singleNode('flowB', 'b');

    dispatcher.registerBundle({ 'nodes': [nodeA, nodeB], 'dags': [dagA, dagB] });

    assert.equal(dispatcher.getNode('urn:noocodec:node:a'), nodeA);
    assert.equal(dispatcher.getNode('urn:noocodec:node:b'), nodeB);
    assert.equal(dispatcher.getDAG(testDagIri('flowA')), dagA);
    assert.equal(dispatcher.getDAG(testDagIri('flowB')), dagB);
    assert.equal(dispatcher.listNodes().length, 2);
    assert.equal(dispatcher.listDAGs().length, 2);
  });

  void it('accepts an empty nodes array when DAGs reference already-registered nodes', () => {
    const dispatcher = new Dagonizer<NodeStateInterface>();
    const nodeA = TestNode.make('urn:noocodec:node:a', ['done'], () => 'done');
    dispatcher.registerNode(nodeA);
    const dagA = TestRegistryDag.singleNode('flowA', 'a');

    dispatcher.registerBundle({ 'nodes': [], 'dags': [dagA] });

    assert.equal(dispatcher.getDAG(testDagIri('flowA')), dagA);
    assert.equal(dispatcher.listNodes().length, 1);
    assert.equal(dispatcher.listDAGs().length, 1);
  });

  void it('accepts an empty dags array and registers nodes only', () => {
    const dispatcher = new Dagonizer<NodeStateInterface>();
    const nodeA = TestNode.make('urn:noocodec:node:a', ['done'], () => 'done');
    const nodeB = TestNode.make('urn:noocodec:node:b', ['done'], () => 'done');

    dispatcher.registerBundle({ 'nodes': [nodeA, nodeB], 'dags': [] });

    assert.equal(dispatcher.getNode('urn:noocodec:node:a'), nodeA);
    assert.equal(dispatcher.getNode('urn:noocodec:node:b'), nodeB);
    assert.deepEqual(dispatcher.listDAGs(), []);
  });

  void it('throws on a DAG referencing an unregistered node and rolls back bundle additions', () => {
    const dispatcher = new Dagonizer<NodeStateInterface>();
    const nodeA = TestNode.make('urn:noocodec:node:a', ['done'], () => 'done');
    const danglingDAG = TestRegistryDag.singleNode('dangling', 'missing');

    assert.throws(
      () => dispatcher.registerBundle({ 'nodes': [nodeA], 'dags': [danglingDAG] }),
      /unknown registered node: urn:noocodec:node:missing/,
    );

    assert.equal(dispatcher.getNode('urn:noocodec:node:a'), undefined);
    assert.equal(dispatcher.getDAG(testDagIri('dangling')), undefined);
  });

  void it('resolves DAG references to nodes defined in the same bundle (nodes register first)', () => {
    const dispatcher = new Dagonizer<NodeStateInterface>();
    const nodeA = TestNode.make('urn:noocodec:node:a', ['done'], () => 'done');
    const dagA = TestRegistryDag.singleNode('flowA', 'a');

    // Order in the bundle's `dags` array references a node that only exists
    // in the same bundle's `nodes` array; succeeds because nodes register first.
    dispatcher.registerBundle({ 'nodes': [nodeA], 'dags': [dagA] });

    assert.equal(dispatcher.getNode('urn:noocodec:node:a'), nodeA);
    assert.equal(dispatcher.getDAG(testDagIri('flowA')), dagA);
  });

  void it('resolves DAG references to DAGs defined later in the same bundle', () => {
    const dispatcher = new Dagonizer<NodeStateInterface>();
    const parentDag = TestRegistryDag.embedded('parent-flow', 'invoke-child', testDagIri('child-flow'));
    const childDag = TestRegistryDag.terminalOnly('child-flow');

    dispatcher.registerBundle({ 'nodes': [], 'dags': [parentDag, childDag] });

    assert.equal(dispatcher.getDAG(testDagIri('parent-flow')), parentDag);
    assert.equal(dispatcher.getDAG(testDagIri('child-flow')), childDag);
  });

  void it('validates self-recursive dynamic DagReference candidates against the staged DAG registry', () => {
    const dispatcher = new Dagonizer<NodeStateInterface>();
    const router = TestNode.make('urn:noocodec:node:self-router', ['done', 'recurse'], () => 'done');
    const dagIri = testDagIri('self-flow');
    const routeIri = testPlacementIri(dagIri, 'route');
    const invokeSelfIri = testPlacementIri(dagIri, 'invoke-self');
    const endIri = testPlacementIri(dagIri, 'end');
    const selfDag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id': dagIri,
      '@type': 'DAG',
      'name': 'self-flow',
      'version': '1',
      'entrypoints': { 'main': routeIri },
      'nodes': [{
        '@id': routeIri,
        '@type': 'SingleNode',
        'name': 'route',
        'node': 'urn:noocodec:node:self-router',
        'outputs': { 'done': endIri, 'recurse': invokeSelfIri },
      }, {
        '@id': invokeSelfIri,
        '@type': 'EmbeddedDAGNode',
        'name': 'invoke-self',
        'dag': {
          '@type': 'DagReference',
          'from': 'state',
          'path': 'nextDag',
          'candidates': [dagIri],
        },
        'outputs': { 'success': endIri, 'error': endIri },
      },
        { '@id': endIri, '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };

    dispatcher.registerBundle({ 'nodes': [router], 'dags': [selfDag] });

    assert.equal(dispatcher.getDAG(dagIri), selfDag);
  });

  void it('rejects recursive components whose only terminal routes happen after recursive calls', () => {
    const dispatcher = new Dagonizer<NodeStateInterface>();
    const dagA = TestRegistryDag.embedded('after-call-a', 'invoke-b', testDagIri('after-call-b'));
    const dagB = TestRegistryDag.embedded('after-call-b', 'invoke-a', testDagIri('after-call-a'));

    assert.throws(
      () => dispatcher.registerBundle({ 'nodes': [], 'dags': [dagA, dagB] }),
      /no terminal exit path/u,
    );

    assert.equal(dispatcher.getDAG(testDagIri('after-call-a')), undefined);
    assert.equal(dispatcher.getDAG(testDagIri('after-call-b')), undefined);
  });

  void it('rejects recursive components without a reachable terminal exit and rolls back staged DAGs', () => {
    const dispatcher = new Dagonizer<NodeStateInterface>();
    const dagA = TestRegistryDag.recursiveNoExit('loop-a', 'invoke-b', testDagIri('loop-b'));
    const dagB = TestRegistryDag.recursiveNoExit('loop-b', 'invoke-a', testDagIri('loop-a'));

    assert.throws(
      () => dispatcher.registerBundle({ 'nodes': [], 'dags': [dagA, dagB] }),
      /no terminal exit path/u,
    );

    assert.equal(dispatcher.getDAG(testDagIri('loop-a')), undefined);
    assert.equal(dispatcher.getDAG(testDagIri('loop-b')), undefined);
  });
});
