/**
 * Tests for the `dagFrom` runtime dag-name resolution feature.
 *
 * `EmbeddedDAGNode` and `ScatterNode` can read the dag name from a dotted
 * state path at execution time (`dagFrom`) in addition to the build-time
 * literal (`dag`). An unresolved or unregistered dag name routes to the
 * placement's `error` output without throwing. The validator enforces
 * exactly-one-of `dag` | `dagFrom` at wire-load time.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import { ScalarNode } from '../../src/core/ScalarNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAGType } from '../../src/entities/dag/DAG.js';
import type { NodeContextType } from '../../src/entities/node/NodeContext.js';
import type { NodeOutputType } from '../../src/entities/node/NodeOutput.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * A shared execution probe. Scatter runs each item's body on an isolated clone,
 * so per-clone state never reaches the parent; the probe counts real child-dag
 * executions across every clone regardless of the gather strategy. It is a plain
 * data object injected via constructor — not a callback.
 */
class ExecutionProbe {
  count = 0;
}

class RoutingState extends NodeStateBase {
  /** The dag name placed here by a setup node and read by the dagFrom embed. */
  selectedDag = '';
  /** Execution counter threaded through the cardinality-1 embed via state mapping. */
  executed = 0;
  /** Scatter items: each names its own body dag (read by the scatter `dagFrom`). */
  items: Array<{ dagName: string }> = [{ 'dagName': 'scatter-child' }, { 'dagName': 'scatter-child' }];
}

/** Increments `state.executed` (for state round-trip) and the shared probe. */
class IncrNode extends ScalarNode<RoutingState, 'success' | 'error'> {
  readonly name: string;
  readonly outputs = ['success', 'error'] as const;
  readonly #probe: ExecutionProbe;

  constructor(name: string, probe: ExecutionProbe) {
    super();
    this.name = name;
    this.#probe = probe;
  }

  protected async executeOne(
    state: RoutingState,
    _ctx: NodeContextType,
  ): Promise<NodeOutputType<'success' | 'error'>> {
    state.executed += 1;
    this.#probe.count += 1;
    return { 'errors': [], 'output': 'success' };
  }
}

/** Sets `state.selectedDag` to the provided value then routes success. */
class SetDagNode extends ScalarNode<RoutingState, 'success'> {
  readonly name: string;
  readonly outputs = ['success'] as const;
  readonly #dagName: string;

  constructor(name: string, dagName: string) {
    super();
    this.name = name;
    this.#dagName = dagName;
  }

  protected async executeOne(
    state: RoutingState,
    _ctx: NodeContextType,
  ): Promise<NodeOutputType<'success'>> {
    state.selectedDag = this.#dagName;
    return { 'errors': [], 'output': 'success' };
  }
}

/** DAG-shaped fixtures: terminals and a minimal child DAG. */
class TestDag {
  private constructor() { /* static-only */ }

  static terminal(dagName: string): DAGType['nodes'][number] {
    return {
      '@id':     `urn:noocodex:dag:${dagName}/node/end`,
      '@type':   'TerminalNode',
      'name':    'end',
      'outcome': 'completed',
    };
  }

  static failedTerminal(dagName: string): DAGType['nodes'][number] {
    return {
      '@id':     `urn:noocodex:dag:${dagName}/node/end-fail`,
      '@type':   'TerminalNode',
      'name':    'end-fail',
      'outcome': 'failed',
    };
  }

  /** A minimal 1-node child DAG that runs the `incr` node. */
  static child(name: string): DAGType {
    return {
      '@context': DAG_CONTEXT,
      '@id':      `urn:noocodex:dag:${name}`,
      '@type':    'DAG',
      'name':     name,
      'version':  '1',
      'entrypoint': 'run',
      'nodes': [
        {
          '@id':   `urn:noocodex:dag:${name}/node/run`,
          '@type': 'SingleNode',
          'name':  'run',
          'node':  'incr',
          'outputs': { 'success': 'end', 'error': 'end-fail' },
        },
        TestDag.terminal(name),
        TestDag.failedTerminal(name),
      ],
    };
  }
}

// ── EmbeddedDAGNode dagFrom tests ─────────────────────────────────────────────

void describe('EmbeddedDAGNode: dagFrom runtime resolution', () => {
  void it('resolves the dag name from a state path and executes the child dag', async () => {
    const probe = new ExecutionProbe();
    const incrNode = new IncrNode('incr', probe);
    const setNode = new SetDagNode('set-dag', 'child-a');
    const childDag = TestDag.child('child-a');

    const parentDag = new DAGBuilder('parent', '1')
      .node('set-dag', setNode, { 'success': 'invoke' })
      .embeddedDAG<RoutingState, RoutingState>('invoke', { 'from': 'selectedDag' }, { 'success': 'end', 'error': 'end-fail' }, {
        'inputs':  { 'executed': 'executed' },
        'outputs': { 'executed': 'executed' },
      })
      .terminal('end')
      .terminal('end-fail', { 'outcome': 'failed' })
      .build();

    const dispatcher = new Dagonizer<RoutingState>();
    dispatcher.registerNode(incrNode);
    dispatcher.registerNode(setNode);
    dispatcher.registerDAG(childDag);
    dispatcher.registerDAG(parentDag);

    const state = new RoutingState();
    const result = await dispatcher.execute('parent', state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(probe.count, 1, 'child dag should have executed once');
    assert.equal(state.executed, 1, 'child increment maps back into parent state');
  });

  void it('routes to error when dagFrom resolves to an unregistered dag name', async () => {
    const setNode = new SetDagNode('set-dag', 'does-not-exist');

    const parentDag = new DAGBuilder('parent-missing', '1')
      .node('set-dag', setNode, { 'success': 'invoke' })
      .embeddedDAG('invoke', { 'from': 'selectedDag' }, { 'success': 'end-ok', 'error': 'end-fail' })
      .terminal('end-ok')
      .terminal('end-fail', { 'outcome': 'failed' })
      .build();

    const dispatcher = new Dagonizer<RoutingState>();
    dispatcher.registerNode(setNode);
    dispatcher.registerDAG(parentDag);

    const state = new RoutingState();
    const result = await dispatcher.execute('parent-missing', state);

    assert.equal(result.terminalOutcome, 'failed', 'unregistered dag → error output → failed terminal');
  });

  void it('routes to error when dagFrom path resolves to an empty string', async () => {
    // selectedDag starts as '' — an empty string is not a valid dag name.
    const parentDag = new DAGBuilder('parent-empty', '1')
      .embeddedDAG('invoke', { 'from': 'selectedDag' }, { 'success': 'end-ok', 'error': 'end-fail' })
      .terminal('end-ok')
      .terminal('end-fail', { 'outcome': 'failed' })
      .build();

    const dispatcher = new Dagonizer<RoutingState>();
    dispatcher.registerDAG(parentDag);

    const state = new RoutingState(); // selectedDag === ''
    const result = await dispatcher.execute('parent-empty', state);

    assert.equal(result.terminalOutcome, 'failed');
  });
});

// ── ScatterNode dagFrom tests ─────────────────────────────────────────────────

void describe('ScatterNode: dagFrom runtime resolution', () => {
  void it('resolves each item dag name from clone state and runs the sub-dag per item', async () => {
    const probe = new ExecutionProbe();
    const incrNode = new IncrNode('incr', probe);
    const childDag = TestDag.child('scatter-child');

    // Each scatter item names its own body dag; `dagFrom: 'dagName'` reads it
    // from the item directly (not from the clone state).
    const parentDag = new DAGBuilder('scatter-parent', '1')
      .scatter('scatter', 'items', { 'dagFrom': 'dagName' }, {
        'all-success': 'end',
        'partial':     'end',
        'all-error':   'end',
        'empty':       'end',
      }, {
        'gather': { 'strategy': 'discard' },
      })
      .terminal('end')
      .build();

    const dispatcher = new Dagonizer<RoutingState>();
    dispatcher.registerNode(incrNode);
    dispatcher.registerDAG(childDag);
    dispatcher.registerDAG(parentDag);

    const state = new RoutingState();
    state.items = [{ 'dagName': 'scatter-child' }, { 'dagName': 'scatter-child' }, { 'dagName': 'scatter-child' }];
    const result = await dispatcher.execute('scatter-parent', state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(probe.count, 3, 'child dag should run once per item');
  });

  void it('routes scatter items to error when dagFrom resolves to an unregistered dag', async () => {
    const probe = new ExecutionProbe();
    const incrNode = new IncrNode('incr', probe);

    const parentDag = new DAGBuilder('scatter-bad', '1')
      .scatter('scatter', 'items', { 'dagFrom': 'dagName' }, {
        'all-success': 'end-ok',
        'partial':     'end-ok',
        'all-error':   'end-ok',
        'empty':       'end-ok',
      }, {
        'gather': { 'strategy': 'discard' },
      })
      .terminal('end-ok')
      .build();

    const dispatcher = new Dagonizer<RoutingState>();
    dispatcher.registerNode(incrNode);
    dispatcher.registerDAG(parentDag);

    const state = new RoutingState();
    state.items = [{ 'dagName': 'no-such-dag' }, { 'dagName': 'no-such-dag' }];
    const result = await dispatcher.execute('scatter-bad', state);

    // All items routed to their error output; scatter still reaches its terminal.
    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(probe.count, 0, 'no child dag ran');
  });
});

// ── Validator: exactly-one-of dag | dagFrom ───────────────────────────────────
//
// The semantic constraint (exactly one of `dag` | `dagFrom`) is enforced when
// `registerDAG` validates the DAG. Wire-shape schema validation runs first and
// may catch invalid shapes before the semantic check.

void describe('DAGValidator: embedded dag exactly-one-of constraint', () => {
  void it('registerDAG rejects a node with both dag and dagFrom set', () => {
    const dispatcher = new Dagonizer<RoutingState>();
    // Register a child dag first (the dag:'some-child' reference must resolve);
    // its `run` node references `incr`, so that node must exist too.
    dispatcher.registerNode(new IncrNode('incr', new ExecutionProbe()));
    dispatcher.registerDAG(TestDag.child('some-child'));

    const bogus: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:bogus-both',
      '@type':    'DAG',
      'name':     'bogus-both',
      'version':  '1',
      'entrypoint': 'embed',
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:bogus-both/node/embed',
          '@type':  'EmbeddedDAGNode',
          'name':   'embed',
          // Both set — invalid: exactly one of dag | dagFrom is allowed.
          'dag':     'some-child',
          'dagFrom': 'selectedDag',
          'outputs': { 'success': 'end', 'error': 'end' },
        } as unknown as DAGType['nodes'][number],
        TestDag.terminal('bogus-both'),
      ],
    };

    assert.throws(() => dispatcher.registerDAG(bogus));
  });

  void it('registerDAG rejects a node with neither dag nor dagFrom set', () => {
    const dispatcher = new Dagonizer<RoutingState>();

    const bogus: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:bogus-neither',
      '@type':    'DAG',
      'name':     'bogus-neither',
      'version':  '1',
      'entrypoint': 'embed',
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:bogus-neither/node/embed',
          '@type':  'EmbeddedDAGNode',
          'name':   'embed',
          // Neither dag nor dagFrom — invalid.
          'outputs': { 'success': 'end', 'error': 'end' },
        } as unknown as DAGType['nodes'][number],
        TestDag.terminal('bogus-neither'),
      ],
    };

    assert.throws(() => dispatcher.registerDAG(bogus));
  });

  void it('registerDAG accepts a node with only dag set', () => {
    const dispatcher = new Dagonizer<RoutingState>();
    const childDag = TestDag.child('valid-child-literal');

    const parentDag = new DAGBuilder('valid-literal', '1')
      .embeddedDAG('embed', 'valid-child-literal', { 'success': 'end', 'error': 'end-fail' })
      .terminal('end')
      .terminal('end-fail', { 'outcome': 'failed' })
      .build();

    // The child's `run` node references `incr`, so that node must exist.
    dispatcher.registerNode(new IncrNode('incr', new ExecutionProbe()));
    dispatcher.registerDAG(childDag);
    assert.doesNotThrow(() => dispatcher.registerDAG(parentDag));
  });

  void it('registerDAG accepts a node with only dagFrom set (no static registration required)', () => {
    const dispatcher = new Dagonizer<RoutingState>();

    const parentDag = new DAGBuilder('valid-from-only', '1')
      .embeddedDAG('embed', { 'from': 'selectedDag' }, { 'success': 'end', 'error': 'end-fail' })
      .terminal('end')
      .terminal('end-fail', { 'outcome': 'failed' })
      .build();

    // dagFrom: no static child-dag registration needed — checked at runtime only.
    assert.doesNotThrow(() => dispatcher.registerDAG(parentDag));
  });
});
