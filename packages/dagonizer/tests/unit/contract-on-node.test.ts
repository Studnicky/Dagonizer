import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NodeInterface, Chainable  } from '../../src/contracts/NodeInterface.js';
import type { OperationContractFragment } from '../../src/contracts/OperationContractFragment.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { ContractRegistryValidator } from '../../src/derive/ContractRegistryValidator.js';
import { DAGDeriver } from '../../src/derive/DAGDeriver.js';
import { DAGError } from '../../src/errors/DAGError.js';
import type { NodeStateBase } from '../../src/NodeStateBase.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(
  name: string,
  outputs: readonly string[],
  contract?: OperationContractFragment,
): NodeInterface<NodeStateBase, string> {
  const base: NodeInterface<NodeStateBase, string> = {
    name,
    outputs,
    async execute() { return { 'output': outputs[0] ?? 'success' }; },
  };
  if (contract !== undefined) {
    return { ...base, contract };
  }
  return base;
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
    });

    assert.equal(dag.name, 'node-chain');
    assert.equal(dag.entrypoint, 'a');
    assert.equal(dag['@type'], 'DAG');

    const names = dag.nodes.map((node) => node.name);
    assert.deepEqual(names, ['a', 'b', 'c']);

    const a = dag.nodes[0];
    if (a !== undefined && a['@type'] === 'SingleNode') {
      assert.equal(a.outputs['success'], 'b');
    } else {
      assert.fail('expected first node to be SingleNode');
    }

    const c = dag.nodes[2];
    if (c !== undefined && c['@type'] === 'SingleNode') {
      assert.equal(c.outputs['success'], null);
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
      () => ContractRegistryValidator.validate(contracts, () => { /* no-op */ }, 'a'),
      (err: unknown) => {
        assert.ok(err instanceof DAGError);
        assert.ok(err.message.includes("hardRequires 'missing-path'"));
        assert.ok(err.message.includes('no upstream-in-DAG node produces it'));
        return true;
      },
    );
  });

  void it('calls onContractWarning for a dead write (produces not required by any node)', () => {
    // 'root' is the entrypoint; its hardRequired are skipped.
    // 'a' produces 'x' (consumed by 'b') and 'unused' (consumed by nobody) → dead-write warning.
    const contracts = [
      { 'name': 'root', 'hardRequired': [],        'produces': ['input'],         'outputs': ['success'] },
      { 'name': 'a',    'hardRequired': ['input'],  'produces': ['x', 'unused'],  'outputs': ['success'] },
      { 'name': 'b',    'hardRequired': ['x'],      'produces': ['done'],         'outputs': ['success'] },
    ];
    const warnings: string[] = [];
    ContractRegistryValidator.validate(contracts, (msg) => { warnings.push(msg); }, 'root');
    // 'unused' is produced by 'a' but not required by anyone → dead-write warning
    const unusedWarning = warnings.find((w) => w.includes("'unused'"));
    assert.ok(unusedWarning !== undefined, `expected a dead-write warning for 'unused', got: ${JSON.stringify(warnings)}`);
    assert.ok(unusedWarning.includes('produces'), `warning mentions produces`);
  });

  void it('does not warn when all produces are consumed', () => {
    const contracts = [
      { 'name': 'a', 'hardRequired': [],    'produces': ['x'], 'outputs': ['success'] },
      { 'name': 'b', 'hardRequired': ['x'], 'produces': ['y'], 'outputs': ['success'] },
    ];
    const warnings: string[] = [];
    // 'x' is consumed by 'b'; no warning for 'x'.
    // 'y' is produced by 'b' but not required; will warn.
    ContractRegistryValidator.validate(contracts, (msg) => { warnings.push(msg); }, 'a');
    const xWarning = warnings.find((w) => w.includes("'x'"));
    assert.equal(xWarning, undefined, "'x' is consumed so no dead-write warning expected");
  });

  void it('does not throw when all hardRequired paths are produced by upstream nodes', () => {
    const contracts = [
      { 'name': 'root', 'hardRequired': [],       'produces': ['a-out'], 'outputs': ['success'] },
      { 'name': 'leaf', 'hardRequired': ['a-out'], 'produces': ['done'], 'outputs': ['success'] },
    ];
    assert.doesNotThrow(() => ContractRegistryValidator.validate(contracts, () => { /* no-op */ }, 'root'));
  });

  void it('does not flag entrypoint hardRequired as dangling reads', () => {
    // 'a' is the entrypoint and hardRequires 'initial-input', which no node produces.
    // This is valid: 'initial-input' is external state seeded before execution.
    const contracts = [
      { 'name': 'a', 'hardRequired': ['initial-input'], 'produces': ['x'], 'outputs': ['success'] },
      { 'name': 'b', 'hardRequired': ['x'],             'produces': ['y'], 'outputs': ['success'] },
    ];
    assert.doesNotThrow(
      () => ContractRegistryValidator.validate(contracts, () => { /* no-op */ }, 'a'),
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
    // Declare nodes with as-const literal contracts so the type system
    // can see the exact string literals in hardRequired / produces.
    const _fetchNode = {
      'name': 'fetch',
      'outputs': ['success'] as const,
      'contract': {
        'hardRequired': ['url'] as const,
        'produces': ['raw'] as const,
      },
      async execute() { return { 'output': 'success' as const }; },
    } satisfies NodeInterface;

    const _parseNode = {
      'name': 'parse',
      'outputs': ['success'] as const,
      'contract': {
        'hardRequired': ['raw'] as const,
        'produces': ['record'] as const,
      },
      async execute() { return { 'output': 'success' as const }; },
    } satisfies NodeInterface;

    // This type assertion compiles only when Chainable<_fetchNode, _parseNode> = true.
    type _CheckChainable = Chainable<typeof _fetchNode, typeof _parseNode>;
    const _assert: _CheckChainable = true;
    assert.ok(_assert, 'Chainable resolves to true at runtime for compatible node pair');
  });
});
