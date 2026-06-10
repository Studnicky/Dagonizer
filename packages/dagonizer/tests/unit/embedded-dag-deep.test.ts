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
    return { 'errors': [], 'output': 'success' };
  },
});

// Identity state mapping: seed the child's `value` from the parent and copy it
// back out. Applied at every embed boundary so the accumulator survives the
// full descent and ascent.
const VALUE_MAPPING = { 'input': { 'value': 'value' }, 'output': { 'value': 'value' } } as const;

const singleNode = (dag: string, name: string, outputs: Record<string, string>): DAG['nodes'][number] => ({
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
  'outputs': { 'success': 'end', 'error': 'end' },
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

const terminalNode = (dag: string): DAG['nodes'][number] => ({
  '@id':     `urn:noocodex:dag:${dag}/node/end`,
  '@type':   'TerminalNode',
  'name':    'end',
  'outcome': 'completed',
});

// core ← inner ← mid ← outer  (three levels of embedding: nested in nested in nested)
const coreDAG  = makeDAG('deep-core',  'inc-core',  [
  singleNode('deep-core', 'inc-core', { 'success': 'end' }),
  terminalNode('deep-core'),
]);
const innerDAG = makeDAG('deep-inner', 'inc-inner', [
  singleNode('deep-inner', 'inc-inner', { 'success': 'embed-core' }),
  embedNode('deep-inner', 'embed-core', 'deep-core'),
  terminalNode('deep-inner'),
]);
const midDAG = makeDAG('deep-mid', 'inc-mid', [
  singleNode('deep-mid', 'inc-mid', { 'success': 'embed-inner' }),
  embedNode('deep-mid', 'embed-inner', 'deep-inner'),
  terminalNode('deep-mid'),
]);
const outerDAG = makeDAG('deep-outer', 'inc-outer', [
  singleNode('deep-outer', 'inc-outer', { 'success': 'embed-mid' }),
  embedNode('deep-outer', 'embed-mid', 'deep-mid'),
  terminalNode('deep-outer'),
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
    assert.equal(result.terminalOutcome, 'completed');
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

  void it('cannot construct a cross-kind cycle: the append-only registry refuses the closing re-registration', () => {
    const dispatcher = new Dagonizer<CounterState>();
    dispatcher.registerNode(incNode('na', 1));

    // a (standalone) ← b embeds a. Acyclic.
    dispatcher.registerDAG(makeDAG('cyc-a', 'na', [
      singleNode('cyc-a', 'na', { 'success': 'end' }),
      terminalNode('cyc-a'),
    ]));
    dispatcher.registerDAG(makeDAG('cyc-b', 'embed-a', [
      embedNode('cyc-b', 'embed-a', 'cyc-a'),
      terminalNode('cyc-b'),
    ]));

    // The only way to close a cross-kind cycle (a SCATTERS into b → b embeds a)
    // is to re-register 'cyc-a' so it references 'cyc-b'. Because every sub-DAG
    // reference must resolve to an already-registered DAG, references are
    // backward-only; the sole route to a cycle is mutating an existing
    // registration. The registry is append-only, so this re-registration is
    // refused with 'already registered' before any cyclic state can install —
    // a cross-kind cycle is structurally unconstructable through the registry.
    const cyclicA = makeDAG('cyc-a', 'fork-b', [{
      '@id':    'urn:noocodex:dag:cyc-a/node/fork-b',
      '@type':  'ScatterNode',
      'name':   'fork-b',
      'source': 'items',
      'body':   { 'dag': 'cyc-b' },
      'gather': { 'strategy': 'discard' },
      'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
    },
      terminalNode('cyc-a'),
    ]);

    assert.throws(() => dispatcher.registerDAG(cyclicA), /already registered/u);
  });
});
