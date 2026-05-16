import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import {
  FanInStrategies,
  FanInStrategy,
  ParallelCombiner,
  ParallelCombiners,
} from '../../src/core/index.js';
import type { FanInExecution, ParallelResult } from '../../src/core/index.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { DAG, FanInConfig } from '../../src/entities/index.js';
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

void describe('FanInStrategies registry', () => {
  void it('lists default strategies on first import', () => {
    const names = FanInStrategies.list();
    assert.ok(names.includes('append'));
    assert.ok(names.includes('partition'));
    assert.ok(names.includes('custom'));
  });

  void it('resolves a default strategy by name', () => {
    const strategy = FanInStrategies.resolve('append');
    assert.equal(strategy.name, 'append');
  });

  void it('throws for an unknown strategy name', () => {
    assert.throws(() => FanInStrategies.resolve('top-n'));
  });

  void it('custom strategy class extends and registers', () => {
    class TopOneFanIn extends FanInStrategy {
      readonly name = 'top-one';
      async apply<TState extends NodeStateInterface>(
        _config: FanInConfig,
        execution: FanInExecution<TState>,
      ): Promise<void> {
        const all = [...execution.results.values()].flat();
        execution.accessor.set(execution.state, 'top', all[0] ?? null);
      }
    }
    FanInStrategies.register(new TopOneFanIn());
    const strategy = FanInStrategies.resolve('top-one');
    assert.equal(strategy.name, 'top-one');
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
      'name': 'demo',
      'version': '1',
      'entrypoint': 'greet',
      'nodes': [{ 'type': 'single', 'name': 'greet', 'node': 'greet', 'outputs': { 'done': null } }],
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
