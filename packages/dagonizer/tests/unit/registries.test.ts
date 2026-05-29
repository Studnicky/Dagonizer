import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import {
  GatherStrategies,
  GatherStrategy,
  OutcomeReducer,
  OutcomeReducers,
  ParallelCombiner,
  ParallelCombiners,
} from '../../src/core/index.js';
import type { GatherExecution, OutcomeRecord, ParallelResult } from '../../src/core/index.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAG, GatherConfig } from '../../src/entities/index.js';
import type { NodeStateInterface } from '../../src/NodeStateBase.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

const makeNode = (
  name: string,
  outputs: readonly string[],
  exec: (state: NodeStateBase) => Promise<string> | string,
): NodeInterface<NodeStateBase> => ({
  name,
  outputs,
  async execute(state) {
    const output = await exec(state);
    return { output };
  },
});

void describe('ParallelCombiners registry', () => {
  void it('lists default combiners on first import', () => {
    const names = ParallelCombiners.list();
    assert.ok(names.includes('all-success'));
    assert.ok(names.includes('any-success'));
    assert.ok(names.includes('collect'));
  });

  void it('resolves a default combiner by name', () => {
    const combiner = ParallelCombiners.resolve('all-success');
    assert.equal(combiner.name, 'all-success');
    assert.equal(
      combiner.combine(['success', 'success'], [], new NodeStateBase()),
      'success',
    );
  });

  void it('throws for an unknown combiner name', () => {
    assert.throws(() => ParallelCombiners.resolve('weighted-success'));
  });

  void it('register installs a custom combiner that resolves by name', () => {
    class MajorityCombiner extends ParallelCombiner {
      readonly name = 'majority';
      combine(outputs: readonly string[]): string {
        const successes = outputs.filter((output) => output === 'success').length;
        return successes * 2 > outputs.length ? 'success' : 'error';
      }
    }
    ParallelCombiners.register(new MajorityCombiner());
    const combiner = ParallelCombiners.resolve('majority');
    assert.equal(combiner.combine(['success', 'success', 'error'], [], new NodeStateBase()), 'success');
    assert.equal(combiner.combine(['success', 'error', 'error'], [], new NodeStateBase()), 'error');
  });

  void it('collect combiner records per-node outputs in metadata', () => {
    const state = new NodeStateBase();
    const results: ParallelResult[] = [
      { 'opResult': { 'output': 'a' }, 'node': { 'name': 'first' } },
      { 'opResult': { 'output': 'b' }, 'node': { 'name': 'second' } },
    ];
    ParallelCombiners.resolve('collect').combine(['a', 'b'], results, state);
    assert.deepEqual(state.getMetadata('parallelOutputs'), { 'first': 'a', 'second': 'b' });
  });
});

void describe('GatherStrategies registry', () => {
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
      async apply<TState extends NodeStateInterface>(
        _config: GatherConfig,
        execution: GatherExecution<TState>,
      ): Promise<void> {
        const first = execution.records[0];
        execution.accessor.set(execution.state, 'top', first?.item ?? null);
      }
    }
    GatherStrategies.register(new TopOneGather());
    const strategy = GatherStrategies.resolve('top-one');
    assert.equal(strategy.name, 'top-one');
  });
});

void describe('OutcomeReducers registry', () => {
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
    const records: OutcomeRecord[] = [
      { 'index': 0, 'output': 'success', 'terminalOutcome': null },
      { 'index': 1, 'output': 'success', 'terminalOutcome': null },
    ];
    assert.equal(reducer.reduce(records), 'all-success');
  });

  void it('aggregate reducer: no success → "all-error"', () => {
    const reducer = OutcomeReducers.resolve('aggregate');
    const records: OutcomeRecord[] = [
      { 'index': 0, 'output': 'error', 'terminalOutcome': null },
      { 'index': 1, 'output': 'error', 'terminalOutcome': null },
    ];
    assert.equal(reducer.reduce(records), 'all-error');
  });

  void it('aggregate reducer: mixed → "partial"', () => {
    const reducer = OutcomeReducers.resolve('aggregate');
    const records: OutcomeRecord[] = [
      { 'index': 0, 'output': 'success', 'terminalOutcome': null },
      { 'index': 1, 'output': 'error',   'terminalOutcome': null },
    ];
    assert.equal(reducer.reduce(records), 'partial');
  });

  void it('terminal reducer: success output → "success"', () => {
    const reducer = OutcomeReducers.resolve('terminal');
    const records: OutcomeRecord[] = [
      { 'index': 0, 'output': 'success', 'terminalOutcome': null },
    ];
    assert.equal(reducer.reduce(records), 'success');
  });

  void it('terminal reducer: error output → "error"', () => {
    const reducer = OutcomeReducers.resolve('terminal');
    const records: OutcomeRecord[] = [
      { 'index': 0, 'output': 'error', 'terminalOutcome': null },
    ];
    assert.equal(reducer.reduce(records), 'error');
  });

  void it('terminal reducer: failed terminalOutcome → "error"', () => {
    const reducer = OutcomeReducers.resolve('terminal');
    const records: OutcomeRecord[] = [
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
      reduce(records: ReadonlyArray<OutcomeRecord>): string {
        const successRate = records.filter((r) => r.output === 'success').length / records.length;
        return successRate >= 0.75 ? 'all-success' : 'partial';
      }
    }
    OutcomeReducers.register(new ThresholdReducer());
    const reducer = OutcomeReducers.resolve('threshold-75');
    assert.equal(reducer.name, 'threshold-75');
    const records: OutcomeRecord[] = [
      { 'index': 0, 'output': 'success', 'terminalOutcome': null },
      { 'index': 1, 'output': 'success', 'terminalOutcome': null },
      { 'index': 2, 'output': 'success', 'terminalOutcome': null },
      { 'index': 3, 'output': 'error',   'terminalOutcome': null },
    ];
    assert.equal(reducer.reduce(records), 'all-success');
  });
});

void describe('Dagonizer.getDAG / listDAGs / getNode / listNodes', () => {
  void it('returns undefined for missing names', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    assert.equal(dispatcher.getDAG('nope'), undefined);
    assert.equal(dispatcher.getNode('nope'), undefined);
    assert.deepEqual(dispatcher.listDAGs(), []);
    assert.deepEqual(dispatcher.listNodes(), []);
  });

  void it('snapshots return registered DAGs and nodes', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    const node = makeNode('greet', ['done'], () => 'done');
    dispatcher.registerNode(node);
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:demo',
      '@type':    'DAG',
      'name': 'demo',
      'version': '1',
      'entrypoint': 'greet',
      'nodes': [{
        '@id':   'urn:noocodex:dag:demo/node/greet',
        '@type': 'SingleNode',
        'name':  'greet', 'node': 'greet', 'outputs': { 'done': null },
      }],
    };
    dispatcher.registerDAG(dag);

    assert.equal(dispatcher.getNode('greet'), node);
    assert.equal(dispatcher.getDAG('demo'), dag);
    assert.deepEqual(dispatcher.listNodes(), [node]);
    assert.deepEqual(dispatcher.listDAGs(), [dag]);
  });

  void it('list snapshots are independent of the registry', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(makeNode('a', ['done'], () => 'done'));
    const before = dispatcher.listNodes();
    dispatcher.registerNode(makeNode('b', ['done'], () => 'done'));
    assert.equal(before.length, 1);
    assert.equal(dispatcher.listNodes().length, 2);
  });

  afterEach(() => { /* no shared state to clean */ });
});

const makeSingleNodeDAG = (dagName: string, nodeName: string): DAG => ({
  '@context': DAG_CONTEXT,
  '@id':      `urn:noocodex:dag:${dagName}`,
  '@type':    'DAG',
  'name':       dagName,
  'version':    '1',
  'entrypoint': nodeName,
  'nodes': [{
    '@id':     `urn:noocodex:dag:${dagName}/node/${nodeName}`,
    '@type':   'SingleNode',
    'name':    nodeName,
    'node':    nodeName,
    'outputs': { 'done': null },
  }],
});

void describe('Dagonizer.registerBundle', () => {
  void it('registers every node then every DAG from the bundle', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    const nodeA = makeNode('a', ['done'], () => 'done');
    const nodeB = makeNode('b', ['done'], () => 'done');
    const dagA = makeSingleNodeDAG('flowA', 'a');
    const dagB = makeSingleNodeDAG('flowB', 'b');

    dispatcher.registerBundle({ 'nodes': [nodeA, nodeB], 'dags': [dagA, dagB] });

    assert.equal(dispatcher.getNode('a'), nodeA);
    assert.equal(dispatcher.getNode('b'), nodeB);
    assert.equal(dispatcher.getDAG('flowA'), dagA);
    assert.equal(dispatcher.getDAG('flowB'), dagB);
    assert.equal(dispatcher.listNodes().length, 2);
    assert.equal(dispatcher.listDAGs().length, 2);
  });

  void it('accepts an empty nodes array when DAGs reference already-registered nodes', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    const nodeA = makeNode('a', ['done'], () => 'done');
    dispatcher.registerNode(nodeA);
    const dagA = makeSingleNodeDAG('flowA', 'a');

    dispatcher.registerBundle({ 'nodes': [], 'dags': [dagA] });

    assert.equal(dispatcher.getDAG('flowA'), dagA);
    assert.equal(dispatcher.listNodes().length, 1);
    assert.equal(dispatcher.listDAGs().length, 1);
  });

  void it('accepts an empty dags array and registers nodes only', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    const nodeA = makeNode('a', ['done'], () => 'done');
    const nodeB = makeNode('b', ['done'], () => 'done');

    dispatcher.registerBundle({ 'nodes': [nodeA, nodeB], 'dags': [] });

    assert.equal(dispatcher.getNode('a'), nodeA);
    assert.equal(dispatcher.getNode('b'), nodeB);
    assert.deepEqual(dispatcher.listDAGs(), []);
  });

  void it('throws on a DAG referencing an unregistered node, with earlier nodes still registered', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    const nodeA = makeNode('a', ['done'], () => 'done');
    const danglingDAG = makeSingleNodeDAG('dangling', 'missing');

    assert.throws(
      () => dispatcher.registerBundle({ 'nodes': [nodeA], 'dags': [danglingDAG] }),
      /unknown registered node: missing/,
    );

    // Node registered before the failing DAG is still installed.
    assert.equal(dispatcher.getNode('a'), nodeA);
    assert.equal(dispatcher.getDAG('dangling'), undefined);
  });

  void it('resolves DAG references to nodes defined in the same bundle (nodes register first)', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    const nodeA = makeNode('a', ['done'], () => 'done');
    const dagA = makeSingleNodeDAG('flowA', 'a');

    // Order in the bundle's `dags` array references a node that only exists
    // in the same bundle's `nodes` array — succeeds because nodes register first.
    dispatcher.registerBundle({ 'nodes': [nodeA], 'dags': [dagA] });

    assert.equal(dispatcher.getNode('a'), nodeA);
    assert.equal(dispatcher.getDAG('flowA'), dagA);
  });
});
