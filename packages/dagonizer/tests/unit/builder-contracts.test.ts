import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import type { OperationContractFragment } from '../../src/contracts/OperationContractFragment.js';
import type { WarningEmitter } from '../../src/contracts/WarningEmitter.js';
import { DAGDeriver } from '../../src/derive/DAGDeriver.js';
import { DAGError } from '../../src/errors/DAGError.js';
import type { NodeStateBase } from '../../src/NodeStateBase.js';

class CollectingWarningEmitter implements WarningEmitter {
  readonly collected: string[] = [];
  warn(message: string): void { this.collected.push(message); }
}

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
    async execute() { return { 'errors': [], 'output': outputs[0] ?? 'success' }; },
  };
  if (contract !== undefined) {
    return { ...base, contract };
  }
  return base;
}

// ---------------------------------------------------------------------------
// build() contract validation
// ---------------------------------------------------------------------------

void describe('DAGBuilder.build() contract validation', () => {
  void it('returns a valid DAG when producer → consumer contracts match correctly', () => {
    const produce = makeNode('produce', ['success'], { 'hardRequired': ['input'], 'produces': ['result'] });
    const consume = makeNode('consume', ['success'], { 'hardRequired': ['result'], 'produces': ['done'] });

    const dag = new DAGBuilder('valid-chain', '1.0')
      .node('produce', produce, { 'success': 'consume' })
      .node('consume', consume, { 'success': 'end' })
      .build();

    assert.equal(dag.name, 'valid-chain');
    assert.equal(dag.entrypoint, 'produce');
    assert.equal(dag.nodes.length, 2);
  });

  void it('throws DAGError when a downstream node hardRequires a path that no upstream node produces', () => {
    const a = makeNode('a', ['success'], { 'hardRequired': ['input'], 'produces': ['x'] });
    const b = makeNode('b', ['success'], { 'hardRequired': ['missing'], 'produces': ['done'] });

    assert.throws(
      () => new DAGBuilder('bad-chain', '1.0')
        .node('a', a, { 'success': 'b' })
        .node('b', b, { 'success': 'end' })
        .build(),
      (err: unknown) => {
        assert.ok(err instanceof DAGError, `expected DAGError, got ${String(err)}`);
        assert.ok(err.message.includes("hardRequires 'missing'"), `message: ${err.message}`);
        return true;
      },
    );
  });

  void it('emits warn() on warningEmitter when a node produces a path no downstream consumer needs', () => {
    const a = makeNode('a', ['success'], { 'hardRequired': ['input'], 'produces': ['used', 'dead'] });
    const b = makeNode('b', ['success'], { 'hardRequired': ['used'],  'produces': ['done'] });

    const emitter = new CollectingWarningEmitter();
    new DAGBuilder('dead-write', '1.0')
      .node('a', a, { 'success': 'b' })
      .node('b', b, { 'success': 'end' })
      .build({ 'warningEmitter': emitter });

    const deadWarning = emitter.collected.find((w) => w.includes("'dead'"));
    assert.ok(deadWarning !== undefined, `expected dead-write warning for 'dead'; got: ${JSON.stringify(emitter.collected)}`);
    assert.ok(deadWarning.includes('produces'), `warning should mention produces; got: ${deadWarning}`);
  });

  void it('silently no-ops on dead writes when warningEmitter is omitted', () => {
    const a = makeNode('a', ['success'], { 'hardRequired': ['input'], 'produces': ['used', 'dead'] });
    const b = makeNode('b', ['success'], { 'hardRequired': ['used'],  'produces': ['done'] });

    // Must not throw; dead writes without a callback are silently ignored.
    assert.doesNotThrow(() =>
      new DAGBuilder('silent-dead-write', '1.0')
        .node('a', a, { 'success': 'b' })
        .node('b', b, { 'success': 'end' })
        .build(),
    );
  });

});

// ---------------------------------------------------------------------------
// DAGBuilder.fromNodes()
// ---------------------------------------------------------------------------

void describe('DAGBuilder.fromNodes()', () => {
  void it('produces the same DAG as the equivalent DAGDeriver.derive({ nodes }) call', () => {
    const nodes: NodeInterface<NodeStateBase, string>[] = [
      makeNode('fetch', ['success'], { 'hardRequired': ['url'],    'produces': ['raw'] }),
      makeNode('parse', ['success'], { 'hardRequired': ['raw'],    'produces': ['record'] }),
      makeNode('save',  ['success'], { 'hardRequired': ['record'], 'produces': ['saved'] }),
    ];
    const annotations = {
      'terminals': {
        'save': [{ 'outcome': 'success', 'emit': { 'name': 'pipeline-end', 'outcome': 'completed' as const } }],
      },
    };

    const fromBuilder = DAGBuilder.fromNodes('pipeline', '1.0', 'fetch', nodes, { annotations });

    const fromDeriver = DAGDeriver.derive({
      'name': 'pipeline',
      'version': '1.0',
      'entrypoint': 'fetch',
      nodes,
      annotations,
    });

    // Structural deep-equal: both should produce identical DAG documents.
    assert.deepEqual(fromBuilder, fromDeriver);
  });

  void it('throws a DAGError when nodes is empty (no contracts to derive from)', () => {
    assert.throws(
      () => DAGBuilder.fromNodes('empty', '1', 'a', []),
      (err: unknown) => {
        assert.ok(err instanceof DAGError, `expected DAGError, got ${String(err)}`);
        return true;
      },
    );
  });

  void it('skips contract-less nodes during derivation (matches deriver behavior)', () => {
    const nodes: NodeInterface<NodeStateBase, string>[] = [
      makeNode('a', ['success'], { 'hardRequired': ['input'], 'produces': ['x'] }),
      makeNode('b', ['success'], { 'hardRequired': ['x'],     'produces': ['y'] }),
      // no contract; should be silently skipped
      makeNode('helper', ['success']),
    ];
    const annotations = {
      'terminals': {
        'b': [{ 'outcome': 'success', 'emit': { 'name': 'skip-end', 'outcome': 'completed' as const } }],
      },
    };

    const dag = DAGBuilder.fromNodes('skip-no-contract', '1', 'a', nodes, { annotations });

    const names = dag.nodes.map((n) => n.name);
    assert.ok(!names.includes('helper'), `'helper' should be skipped; got: ${JSON.stringify(names)}`);
    assert.ok(names.includes('a'),       `'a' must be in topology`);
    assert.ok(names.includes('b'),       `'b' must be in topology`);
  });
});
