import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Chainable } from '../../src/contracts/Chainable.js';
import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { EMPTY_CONTRACT_FRAGMENT } from '../../src/contracts/OperationContractFragment.js';
import type { OperationContractFragment } from '../../src/contracts/OperationContractFragment.js';
import type { WarningEmitter } from '../../src/contracts/WarningEmitter.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { ContractRegistryValidator } from '../../src/derive/ContractRegistryValidator.js';
import { DAGDeriver } from '../../src/derive/DAGDeriver.js';
import { DAGError } from '../../src/errors/DAGError.js';
import type { NodeStateBase } from '../../src/NodeStateBase.js';
import { NoopWarningEmitter } from '../../src/runtime/NoopWarningEmitter.js';
import { Timeout } from '../../src/runtime/Timeout.js';

class CollectingWarningEmitter implements WarningEmitter {
  readonly collected: string[] = [];
  warn(message: string): void { this.collected.push(message); }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class MakeNode implements NodeInterface<NodeStateBase, string> {
  readonly name: string;
  readonly outputs: readonly string[];
  readonly contract: OperationContractFragment;
  readonly timeout: Timeout;
  constructor(name: string, outputs: readonly string[], contract: OperationContractFragment = EMPTY_CONTRACT_FRAGMENT) {
    this.name = name;
    this.outputs = outputs;
    this.contract = contract;
    this.timeout = Timeout.none();
  }
  async execute() { return { 'errors': [], 'output': this.outputs[0] ?? 'success' }; }
}

function makeNode(
  name: string,
  outputs: readonly string[],
  contract?: OperationContractFragment,
): MakeNode {
  return new MakeNode(name, outputs, contract);
}

// ---------------------------------------------------------------------------
// DAGDeriver.derive({ nodes }): same DAG as equivalent contracts call
// ---------------------------------------------------------------------------

void describe('DAGDeriver.derive with co-located contracts', () => {
  void it('builds the same linear DAG shape as an equivalent contracts call', () => {
    const nodes: NodeInterface<NodeStateBase, string>[] = [
      makeNode('a', ['success'], { 'hardRequired': ['input'], 'produces': ['x'] }),
      makeNode('b', ['success'], { 'hardRequired': ['x'],     'produces': ['y'] }),
      makeNode('c', ['success'], { 'hardRequired': ['y'],     'produces': ['z'] }),
    ];
    const dag = DAGDeriver.derive({
      'name': 'node-chain',
      'version': '1',
      'entrypoint': 'a',
      nodes,
      'annotations': {
        'terminals': {
          'c': [{ 'outcome': 'success', 'emit': { 'name': 'chain-end', 'outcome': 'completed' } }],
        },
      },
    });

    assert.equal(dag.name, 'node-chain');
    assert.equal(dag.entrypoint, 'a');
    assert.equal(dag['@type'], 'DAG');

    const names = dag.nodes.map((node) => node.name);
    assert.deepEqual(names, ['a', 'b', 'c', 'chain-end']);

    const a = dag.nodes[0];
    if (a !== undefined && a['@type'] === 'SingleNode') {
      assert.equal(a.outputs['success'], 'b');
    } else {
      assert.fail('expected first node to be SingleNode');
    }

    const c = dag.nodes[2];
    if (c !== undefined && c['@type'] === 'SingleNode') {
      assert.equal(c.outputs['success'], 'chain-end');
    } else {
      assert.fail('expected third node to be SingleNode');
    }
  });

  void it('skips nodes without a contract field during derivation', () => {
    const nodes: NodeInterface<NodeStateBase, string>[] = [
      makeNode('a', ['success'], { 'hardRequired': ['input'], 'produces': ['x'] }),
      makeNode('b', ['success'], { 'hardRequired': ['x'],     'produces': ['y'] }),
      // no contract; skipped by extractContracts
      makeNode('helper', ['success']),
    ];
    const dag = DAGDeriver.derive({
      'name': 'skip-no-contract',
      'version': '1',
      'entrypoint': 'a',
      nodes,
      'annotations': {
        'terminals': {
          'b': [{ 'outcome': 'success', 'emit': { 'name': 'skip-end', 'outcome': 'completed' } }],
        },
      },
    });

    const names = dag.nodes.map((n) => n.name);
    assert.ok(!names.includes('helper'), 'helper node not included in derived topology');
    assert.ok(names.includes('a'), 'a is in topology');
    assert.ok(names.includes('b'), 'b is in topology');
  });

  void it('throws when no node in the registry carries a contract', () => {
    const nodes: NodeInterface<NodeStateBase, string>[] = [
      makeNode('a', ['success']),
      makeNode('b', ['success']),
    ];
    assert.throws(
      () => DAGDeriver.derive({ 'name': 'no-contracts', 'version': '1', 'entrypoint': 'a', nodes }),
      /no node carries a `contract` field/,
    );
  });
});

// ---------------------------------------------------------------------------
// DAGDeriver.extractContracts
// ---------------------------------------------------------------------------

void describe('DAGDeriver.extractContracts', () => {
  void it('projects contract-bearing nodes into OperationContracts', () => {
    const nodes: NodeInterface<NodeStateBase, string>[] = [
      makeNode('a', ['success', 'error'], { 'hardRequired': ['x'], 'produces': ['y'] }),
      makeNode('b', ['success'],          { 'hardRequired': ['y'], 'produces': ['z'] }),
    ];
    const contracts = DAGDeriver.extractContracts(nodes);
    assert.equal(contracts.length, 2);

    const contractA = contracts[0];
    assert.ok(contractA !== undefined);
    assert.equal(contractA.name, 'a');
    assert.deepEqual([...contractA.outputs], ['success', 'error']);
    assert.deepEqual([...contractA.hardRequired], ['x']);
    assert.deepEqual([...contractA.produces], ['y']);
  });

  void it('skips nodes without a contract field', () => {
    const nodes: NodeInterface<NodeStateBase, string>[] = [
      makeNode('with-contract', ['success'], { 'hardRequired': [], 'produces': ['y'] }),
      makeNode('no-contract',   ['success']),
    ];
    const contracts = DAGDeriver.extractContracts(nodes);
    assert.equal(contracts.length, 1);
    assert.equal(contracts[0]?.name, 'with-contract');
  });

  void it('returns an empty array for an empty input', () => {
    const contracts = DAGDeriver.extractContracts([]);
    assert.deepEqual(contracts, []);
  });
});

// ---------------------------------------------------------------------------
// ContractRegistryValidator
// ---------------------------------------------------------------------------

void describe('ContractRegistryValidator', () => {
  void it('throws DAGError for a dangling read (non-entrypoint node requires an unproduced path)', () => {
    // 'a' is the entrypoint; its hardRequired are external initial state.
    // 'b' hardRequires 'missing-path' which no node produces (dangling read).
    const contracts = [
      { 'name': 'a', 'hardRequired': ['input'],        'produces': ['x'],   'outputs': ['success'] },
      { 'name': 'b', 'hardRequired': ['missing-path'], 'produces': ['y'],   'outputs': ['success'] },
    ];
    assert.throws(
      () => ContractRegistryValidator.validate(contracts, new NoopWarningEmitter(), { 'entrypointName': 'a' }),
      (err: unknown) => {
        assert.ok(err instanceof DAGError);
        assert.ok(err.message.includes("hardRequires 'missing-path'"));
        assert.ok(err.message.includes('no upstream-in-DAG node produces it'));
        return true;
      },
    );
  });

  void it('calls warn() on WarningEmitter for a dead write (produces not required by any node)', () => {
    // 'root' is the entrypoint; its hardRequired are skipped.
    // 'a' produces 'x' (consumed by 'b') and 'unused' (consumed by nobody) → dead-write warning.
    const contracts = [
      { 'name': 'root', 'hardRequired': [],        'produces': ['input'],         'outputs': ['success'] },
      { 'name': 'a',    'hardRequired': ['input'],  'produces': ['x', 'unused'],  'outputs': ['success'] },
      { 'name': 'b',    'hardRequired': ['x'],      'produces': ['done'],         'outputs': ['success'] },
    ];
    const emitter = new CollectingWarningEmitter();
    ContractRegistryValidator.validate(contracts, emitter, { 'entrypointName': 'root' });
    // 'unused' is produced by 'a' but not required by anyone → dead-write warning
    const unusedWarning = emitter.collected.find((w) => w.includes("'unused'"));
    assert.ok(unusedWarning !== undefined, `expected a dead-write warning for 'unused', got: ${JSON.stringify(emitter.collected)}`);
    assert.ok(unusedWarning.includes('produces'), `warning mentions produces`);
  });

  void it('does not warn when all produces are consumed', () => {
    const contracts = [
      { 'name': 'a', 'hardRequired': [],    'produces': ['x'], 'outputs': ['success'] },
      { 'name': 'b', 'hardRequired': ['x'], 'produces': ['y'], 'outputs': ['success'] },
    ];
    const emitter = new CollectingWarningEmitter();
    // 'x' is consumed by 'b'; no warning for 'x'.
    // 'y' is produced by 'b' but not required; will warn.
    ContractRegistryValidator.validate(contracts, emitter, { 'entrypointName': 'a' });
    const xWarning = emitter.collected.find((w) => w.includes("'x'"));
    assert.equal(xWarning, undefined, "'x' is consumed so no dead-write warning expected");
  });

  void it('does not throw when all hardRequired paths are produced by upstream nodes', () => {
    const contracts = [
      { 'name': 'root', 'hardRequired': [],       'produces': ['a-out'], 'outputs': ['success'] },
      { 'name': 'leaf', 'hardRequired': ['a-out'], 'produces': ['done'], 'outputs': ['success'] },
    ];
    assert.doesNotThrow(() => ContractRegistryValidator.validate(contracts, new NoopWarningEmitter(), { 'entrypointName': 'root' }));
  });

  void it('does not flag entrypoint hardRequired as dangling reads', () => {
    // 'a' is the entrypoint and hardRequires 'initial-input', which no node produces.
    // This is valid: 'initial-input' is external state seeded before execution.
    const contracts = [
      { 'name': 'a', 'hardRequired': ['initial-input'], 'produces': ['x'], 'outputs': ['success'] },
      { 'name': 'b', 'hardRequired': ['x'],             'produces': ['y'], 'outputs': ['success'] },
    ];
    assert.doesNotThrow(
      () => ContractRegistryValidator.validate(contracts, new NoopWarningEmitter(), { 'entrypointName': 'a' }),
      'entrypoint hardRequired should not throw as dangling read',
    );
  });
});

// ---------------------------------------------------------------------------
// onContractWarning hook: dispatcher integration
// ---------------------------------------------------------------------------

void describe('Dagonizer.onContractWarning hook', () => {
  void it('fires onContractWarning for dead-write in co-located contracts at registerDAG time', async () => {
    const warnings: string[] = [];

    class ObservingDispatcher extends Dagonizer<NodeStateBase> {
      protected override onContractWarning(message: string): void {
        warnings.push(message);
      }
    }

    const dispatcher = new ObservingDispatcher();

    // root has hardRequired: [] so no dangling read
    // 'unused' is produced by 'a' but not required by 'b'
    const rootNode = makeNode('root', ['success'], { 'hardRequired': [], 'produces': ['input'] });
    const aNode    = makeNode('a',    ['success'], { 'hardRequired': ['input'], 'produces': ['x', 'unused'] });
    const bNode    = makeNode('b',    ['success'], { 'hardRequired': ['x'],     'produces': ['done'] });

    dispatcher.registerNode(rootNode);
    dispatcher.registerNode(aNode);
    dispatcher.registerNode(bNode);

    const dag = DAGDeriver.derive({
      'name': 'warn-test',
      'version': '1',
      'entrypoint': 'root',
      "nodes": [rootNode, aNode, bNode],
      'annotations': {
        'terminals': {
          'b': [{ 'outcome': 'success', 'emit': { 'name': 'warn-end', 'outcome': 'completed' } }],
        },
      },
    });

    dispatcher.registerDAG(dag);

    const unusedWarning = warnings.find((w) => w.includes("'unused'"));
    assert.ok(unusedWarning !== undefined, `expected dead-write warning for 'unused'; got: ${JSON.stringify(warnings)}`);
  });
});

// ---------------------------------------------------------------------------
// Type-level Chainable<A, B> test
// ---------------------------------------------------------------------------

void describe('Chainable<A, B> type helper', () => {
  void it('compiles: Chainable resolves to true for compatible node pair', () => {
    // Declare nodes with literal-typed contracts so the type system
    // can see the exact string literals in hardRequired / produces.
    class FetchNode implements NodeInterface {
      readonly name = 'fetch';
      readonly outputs = ['success'] as const;
      readonly contract: { 'hardRequired': ['url']; 'produces': ['raw'] } = {
        'hardRequired': ['url'],
        'produces': ['raw'],
      };
      readonly timeout = Timeout.none();
      async execute() { return { 'errors': [], 'output': 'success' as const }; }
    }

    class ParseNode implements NodeInterface {
      readonly name = 'parse';
      readonly outputs = ['success'] as const;
      readonly contract: { 'hardRequired': ['raw']; 'produces': ['record'] } = {
        'hardRequired': ['raw'],
        'produces': ['record'],
      };
      readonly timeout = Timeout.none();
      async execute() { return { 'errors': [], 'output': 'success' as const }; }
    }

    const _fetchNode = new FetchNode();
    const _parseNode = new ParseNode();

    // This type assertion compiles only when Chainable<_fetchNode, _parseNode> = true.
    type _CheckChainable = Chainable<typeof _fetchNode, typeof _parseNode>;
    const _assert: _CheckChainable = true;
    assert.ok(_assert, 'Chainable resolves to true at runtime for compatible node pair');
  });
});

// ---------------------------------------------------------------------------
// registerDAG credits contracts from embedded/scatter placements
// ---------------------------------------------------------------------------

void describe('registerDAG: embedded/scatter placement contracts', () => {
  void it('credits an EmbeddedDAGNode operation\'s produces so a downstream read is not flagged dangling', () => {
    const d = new Dagonizer<NodeStateBase>();

    const prepare  = makeNode('prepare',  ['success'],          { 'hardRequired': ['input'], 'produces': ['mid'] });
    const invoke   = makeNode('invoke',   ['success', 'error'], { 'hardRequired': ['mid'],   'produces': ['out'] });
    const finalize = makeNode('finalize', ['success'],          { 'hardRequired': ['out'],   'produces': ['final'] });
    // The sub-DAG the embedded placement runs.
    const work     = makeNode('work',     ['success'],          { 'hardRequired': ['mid'],   'produces': ['out'] });

    const child = DAGDeriver.derive({
      'name': 'sub', 'version': '1', 'entrypoint': 'work', 'nodes': [work],
      'annotations': {
        'terminals': {
          'work': [{ 'outcome': 'success', 'emit': { 'name': 'sub-end', 'outcome': 'completed' } }],
        },
      },
    });
    const parent = DAGDeriver.derive({
      'name': 'parent', 'version': '1', 'entrypoint': 'prepare',
      'nodes': [prepare, invoke, finalize],
      'annotations': {
        'embeddedDAGs': { 'invoke': { 'dag': 'sub', 'outputs': ['success', 'error'] } },
        'terminals': {
          'finalize': [{ 'outcome': 'success', 'emit': { 'name': 'parent-end', 'outcome': 'completed' } }],
        },
      },
    });

    for (const n of [prepare, invoke, finalize, work]) d.registerNode(n);
    d.registerDAG(child);

    // `invoke` is rendered as an EmbeddedDAGNode; without crediting its
    // contract, finalize's `out` read would be flagged a dangling read.
    assert.doesNotThrow(() => d.registerDAG(parent));
  });
});
