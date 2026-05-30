import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAG } from '../../src/entities/index.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

// A state carrying one accumulator threaded through every nesting level.
class CounterState extends NodeStateBase {
  value = 0;
}

// One increment node per level; each adds a distinct power of ten so the
// final total proves every level executed exactly once and in order.
const incNode = (name: string, delta: number): NodeInterface<CounterState> => ({
  name,
  'outputs': ['success'],
  async execute(state) {
    state.value += delta;
    return { 'output': 'success' };
  },
});

// Identity state mapping: seed the child's `value` from the parent and copy it
// back out. Applied at every embed boundary so the accumulator survives the
// full descent and ascent.
const VALUE_MAPPING = { 'input': { 'value': 'value' }, 'output': { 'value': 'value' } } as const;

const singleNode = (dag: string, name: string, outputs: Record<string, string | null>): DAG['nodes'][number] => ({
  '@id':   `urn:noocodex:dag:${dag}/node/${name}`,
  '@type': 'SingleNode',
  name,
  'node':  name,
  outputs,
});

const embedNode = (dag: string, name: string, childDag: string): DAG['nodes'][number] => ({
  '@id':   `urn:noocodex:dag:${dag}/node/${name}`,
  '@type': 'EmbeddedDAGNode',
  name,
  'dag':   childDag,
  'stateMapping': VALUE_MAPPING,
  'outputs': { 'success': null, 'error': null },
});

const makeDAG = (name: string, entrypoint: string, nodes: DAG['nodes']): DAG => ({
  '@context': DAG_CONTEXT,
  '@id':      `urn:noocodex:dag:${name}`,
  '@type':    'DAG',
  name,
  'version':  '1',
  entrypoint,
  nodes,
});

// core ← inner ← mid ← outer  (three levels of embedding: nested in nested in nested)
const coreDAG  = makeDAG('deep-core',  'inc-core',  [singleNode('deep-core', 'inc-core', { 'success': null })]);
const innerDAG = makeDAG('deep-inner', 'inc-inner', [
  singleNode('deep-inner', 'inc-inner', { 'success': 'embed-core' }),
  embedNode('deep-inner', 'embed-core', 'deep-core'),
]);
const midDAG = makeDAG('deep-mid', 'inc-mid', [
  singleNode('deep-mid', 'inc-mid', { 'success': 'embed-inner' }),
  embedNode('deep-mid', 'embed-inner', 'deep-inner'),
]);
const outerDAG = makeDAG('deep-outer', 'inc-outer', [
  singleNode('deep-outer', 'inc-outer', { 'success': 'embed-mid' }),
  embedNode('deep-outer', 'embed-mid', 'deep-mid'),
]);

void describe('EmbeddedDAGNode: deep recursive nesting', () => {
  void it('threads state down and back through three nesting levels (nested in nested in nested)', async () => {
    const dispatcher = new Dagonizer<CounterState>();
    dispatcher.registerNode(incNode('inc-outer', 1000));
    dispatcher.registerNode(incNode('inc-mid',    100));
    dispatcher.registerNode(incNode('inc-inner',   10));
    dispatcher.registerNode(incNode('inc-core',     1));
    for (const dag of [coreDAG, innerDAG, midDAG, outerDAG]) dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('deep-outer', new CounterState());

    // 1000 (outer) → seed mid → +100 → seed inner → +10 → seed core → +1,
    // then 1111 copied back up through every output mapping.
    assert.equal(result.state.value, 1111);
    assert.equal(result.terminalOutcome, null);
  });

  void it('accumulates placementPath one segment per nesting level', async () => {
    const seen = new Map<string, readonly string[]>();
    class PathProbe extends Dagonizer<CounterState> {
      protected override onNodeStart(nodeName: string, _state: CounterState, placementPath: readonly string[] = []): void {
        seen.set(nodeName, placementPath);
      }
    }
    const dispatcher = new PathProbe();
    dispatcher.registerNode(incNode('inc-outer', 1000));
    dispatcher.registerNode(incNode('inc-mid',    100));
    dispatcher.registerNode(incNode('inc-inner',   10));
    dispatcher.registerNode(incNode('inc-core',     1));
    for (const dag of [coreDAG, innerDAG, midDAG, outerDAG]) dispatcher.registerDAG(dag);

    await dispatcher.execute('deep-outer', new CounterState());

    // The deepest node ran three embed levels down.
    assert.deepEqual(seen.get('inc-outer'), []);
    assert.deepEqual(seen.get('inc-mid'),   ['embed-mid']);
    assert.deepEqual(seen.get('inc-inner'), ['embed-mid', 'embed-inner']);
    assert.deepEqual(seen.get('inc-core'),  ['embed-mid', 'embed-inner', 'embed-core']);
  });

  void it('detects a cross-kind cycle (scatter → embed → scatter) at registration', () => {
    const dispatcher = new Dagonizer<CounterState>();
    dispatcher.registerNode(incNode('na', 1));
    dispatcher.registerNode(incNode('nb', 1));

    // a (standalone) ← b embeds a. Acyclic so far.
    dispatcher.registerDAG(makeDAG('cyc-a', 'na', [singleNode('cyc-a', 'na', { 'success': null })]));
    dispatcher.registerDAG(makeDAG('cyc-b', 'embed-a', [embedNode('cyc-b', 'embed-a', 'cyc-a')]));

    // Re-register a so it SCATTERS into b → a → b → a, a cross-kind cycle
    // (a's edge is scatter, b's back-edge is embed). The unified detector must
    // catch it even though the two edges are different kinds.
    const cyclicA = makeDAG('cyc-a', 'fork-b', [{
      '@id':    'urn:noocodex:dag:cyc-a/node/fork-b',
      '@type':  'ScatterNode',
      'name':   'fork-b',
      'source': 'items',
      'body':   { 'dag': 'cyc-b' },
      'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null },
    }]);

    assert.throws(() => dispatcher.registerDAG(cyclicA), /Circular/u);
  });
});
