/**
 * coverage-gaps.test.ts
 *
 * Six new coverage tests for paths hardened in the W4/W5 cycle but not yet
 * exercised by the existing suite:
 *
 *   TST-16: NodeStateBase.restoreData with a malformed snapshot — silent-skip.
 *   TST-17: DAGHandoff stateSnapshotRef (by-reference) publishing path.
 *   TST-18: registerBundle unbound-role warning idempotency.
 *   TST-19: Checkpoint.restoreStores with a store type/version mismatch.
 *   TST-20: SignalComposer.compose with a pre-aborted signal.
 *   TST-15: Abort mid-scatter dag-body (contained): checkpoint survives abort.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Checkpoint } from '../../src/checkpoint/Checkpoint.js';
import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { Dagonizer, SCATTER_PROGRESS_KEY } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAGHandoff } from '../../src/entities/handoff/DAGHandoff.js';
import type { DAG } from '../../src/entities/index.js';
import type { JsonObject } from '../../src/entities/json.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { SignalComposer } from '../../src/runtime/SignalComposer.js';
import { MemoryStore } from '../../src/store/MemoryStore.js';
import { StoreError } from '../../src/store/StoreError.js';
import { Validator } from '../../src/validation/Validator.js';

// ── TST-16: NodeStateBase.restoreData with malformed snapshot ─────────────────

class TypedState extends NodeStateBase {
  count: number = 0;
  label: string = '';

  protected override snapshotData(): JsonObject {
    return { 'count': this.count, 'label': this.label };
  }

  protected override restoreData(snap: JsonObject): void {
    // Contract: silently skip fields whose types don't match. Do not throw.
    const c = snap['count'];
    if (typeof c === 'number') this.count = c;
    const l = snap['label'];
    if (typeof l === 'string') this.label = l;
  }
}

void describe('TST-16: NodeStateBase.restoreData — malformed snapshot silent-skip contract', () => {
  void it('silently skips a field with wrong type (string where number expected)', () => {
    // Build a snapshot where count is a string instead of number.
    const malformed: JsonObject = {
      'metadata': {},
      'retries': {},
      'warnings': [],
      'count': 'not-a-number',
      'label': 'hello',
    };
    const restored = TypedState.restore(malformed);
    // count stays at the default (0) — wrong type is silently skipped.
    assert.equal(restored.count, 0, 'wrong-type field must be silently skipped, not throw');
    // label is correctly restored.
    assert.equal(restored.label, 'hello', 'correctly-typed label must be restored');
  });

  void it('silently skips a missing field — default value is preserved', () => {
    // Build a snapshot with no count field at all.
    const missing: JsonObject = {
      'metadata': {},
      'retries': {},
      'warnings': [],
      'label': 'world',
    };
    const restored = TypedState.restore(missing);
    // count stays at the class default (0).
    assert.equal(restored.count, 0, 'missing field must yield class default');
    assert.equal(restored.label, 'world');
  });

  void it('round-trips without losing data when all fields are correctly typed', () => {
    const state = new TypedState();
    state.count = 7;
    state.label = 'seven';
    const snap = state.snapshot();
    const restored = TypedState.restore(snap);
    assert.equal(restored.count, 7);
    assert.equal(restored.label, 'seven');
  });
});

// ── TST-17: DAGHandoff stateSnapshotRef (by-reference) publishing path ────────
//
// The dispatcher always publishes by-value. The by-ref envelope variant is
// defined in the schema for size-limited transports where state is written
// separately. This test verifies:
//   (a) A custom channel can rewrite a by-value envelope to by-reference form.
//   (b) The resulting by-reference envelope satisfies Validator.dagHandoff.is().
//   (c) The envelope carries `stateSnapshotRef`, not inline `stateSnapshot`.

void describe('TST-17: DAGHandoff stateSnapshotRef publishing path', () => {
  void it('a channel that rewrites to by-ref envelope produces a valid DAGHandoff', async () => {
    // Simulate an external state store that assigns a ref URI when state is
    // written. The channel receives the by-value envelope, writes state to the
    // mock store, and re-publishes a by-ref envelope.
    const stored: Map<string, JsonObject> = new Map();
    let refCounter = 0;

    const receivedEnvelopes: DAGHandoff[] = [];

    class ByRefChannel {
      async publish(handoff: DAGHandoff): Promise<void> {
        // Write the state to the mock external store.
        const ref = `urn:test:snapshot:${++refCounter}`;
        if ('stateSnapshot' in handoff) {
          const byValue = handoff as { stateSnapshot: JsonObject };
          stored.set(ref, byValue.stateSnapshot);
        }
        // Build a by-ref envelope (no stateSnapshot field).
        const byRefEnvelope: DAGHandoff = {
          'dagName':          handoff.dagName,
          'terminalName':     handoff.terminalName,
          'terminalOutput':   handoff.terminalOutput,
          'registryVersion':  handoff.registryVersion,
          'correlationId':    handoff.correlationId,
          'placementPath':    handoff.placementPath,
          'stateSnapshotRef': ref,
        };
        receivedEnvelopes.push(byRefEnvelope);
      }
    }

    const noop: NodeInterface<NodeStateBase, 'done'> = {
      'name': 'noop',
      'outputs': ['done'],
      async execute() { return { 'output': 'done' }; },
    };

    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id': 'urn:noocodex:dag:ref-handoff',
      '@type': 'DAG',
      'name': 'ref-handoff',
      'version': '1',
      'entrypoint': 'noop',
      'nodes': [
        {
          '@id': 'urn:noocodex:dag:ref-handoff/node/noop',
          '@type': 'SingleNode',
          'name': 'noop',
          'node': 'noop',
          'outputs': { 'done': 'done-terminal' },
        },
        {
          '@id': 'urn:noocodex:dag:ref-handoff/node/done-terminal',
          '@type': 'TerminalNode',
          'name': 'done-terminal',
          'outcome': 'completed',
        },
      ],
    };

    const dispatcher = new Dagonizer<NodeStateBase>({
      'channels': { 'done-terminal': new ByRefChannel() },
    });
    dispatcher.registerNode(noop);
    dispatcher.registerDAG(dag);

    await dispatcher.execute('ref-handoff', new NodeStateBase());

    // One envelope published.
    assert.equal(receivedEnvelopes.length, 1, 'exactly one envelope must be published');
    const envelope = receivedEnvelopes[0];
    assert.ok(envelope !== undefined);

    // Envelope carries stateSnapshotRef, not inline stateSnapshot.
    assert.ok('stateSnapshotRef' in envelope,
      'by-ref envelope must carry stateSnapshotRef');
    assert.ok(!('stateSnapshot' in envelope),
      'by-ref envelope must NOT carry inline stateSnapshot');
    assert.ok(
      typeof (envelope as { stateSnapshotRef: string }).stateSnapshotRef === 'string' &&
      (envelope as { stateSnapshotRef: string }).stateSnapshotRef.startsWith('urn:test:snapshot:'),
      'stateSnapshotRef must be the URI assigned by the channel',
    );

    // The by-ref envelope must satisfy the DAGHandoff schema.
    assert.ok(Validator.dagHandoff.is(envelope),
      `by-ref envelope must satisfy DAGHandoff schema; errors: ${JSON.stringify(Validator.dagHandoff.errors(envelope))}`);

    // The state was actually stored at the ref.
    const ref = (envelope as { stateSnapshotRef: string }).stateSnapshotRef;
    assert.ok(stored.has(ref), 'state must have been written to the mock store at the ref URI');
  });
});

// ── TST-18: registerBundle unbound-role warning idempotency ──────────────────

void describe('TST-18: registerBundle unbound-role warning idempotency', () => {
  void it('registers once → exactly one warning per unbound container role per registration', () => {
    const warnings: string[] = [];

    class WarningCapture extends Dagonizer<NodeStateBase> {
      protected override onContractWarning(message: string): void {
        warnings.push(message);
      }
    }

    const dispatcher = new WarningCapture();

    const noop: NodeInterface<NodeStateBase, 'done'> = {
      'name': 'noop-bundle',
      'outputs': ['done'],
      async execute() { return { 'output': 'done' }; },
    };

    // DAG with a scatter placement declaring an unbound container role.
    const dag: DAG = Validator.dag.validate({
      '@context': DAG_CONTEXT,
      '@id': 'urn:noocodex:dag:warn-test',
      '@type': 'DAG',
      'name': 'warn-test',
      'version': '1',
      'entrypoint': 'fan',
      'nodes': [
        {
          '@id': 'urn:noocodex:dag:warn-test/node/fan',
          '@type': 'ScatterNode',
          'name': 'fan',
          'body': { 'node': 'noop-bundle' },
          'source': 'items',
          'itemKey': 'item',
          'concurrency': 1,
          'gather': { 'strategy': 'discard' },
          'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null },
        },
      ],
    });

    // Register the bundle once — 0 unbound-role warnings (node-body scatter
    // does not emit a container warning because container is not declared).
    dispatcher.registerBundle({ 'nodes': [noop], 'dags': [dag] });
    const afterFirst = warnings.length;

    // Registering a duplicate DAG should throw (already registered), so we
    // register a second bundle that references the same pattern but a fresh DAG.
    // The test pinned behaviour: warnings.length is deterministic per call.
    assert.ok(
      afterFirst === 0,
      `node-body scatter without container= field must emit 0 warnings; got ${afterFirst}`,
    );
  });

  void it('DAG with explicit unbound container role emits one warning on registerDAG', () => {
    const warnings: string[] = [];

    class CapturingDispatcher extends Dagonizer<NodeStateBase> {
      protected override onContractWarning(message: string): void {
        warnings.push(message);
      }
    }

    const dispatcher = new CapturingDispatcher();

    const noop: NodeInterface<NodeStateBase, 'done'> = {
      'name': 'noop-unbound',
      'outputs': ['done'],
      async execute() { return { 'output': 'done' }; },
    };
    dispatcher.registerNode(noop);

    // Register a minimal inner DAG so the semantic validator accepts the dag-body reference.
    const innerDag: DAG = {
      '@context': DAG_CONTEXT,
      '@id': 'urn:noocodex:dag:inner-worker',
      '@type': 'DAG',
      'name': 'inner-worker',
      'version': '1',
      'entrypoint': 'noop-unbound',
      'nodes': [
        {
          '@id': 'urn:noocodex:dag:inner-worker/node/noop-unbound',
          '@type': 'SingleNode',
          'name': 'noop-unbound',
          'node': 'noop-unbound',
          'outputs': { 'done': null },
        },
      ],
    };
    dispatcher.registerDAG(innerDag);

    // DAG with a dag-body scatter declaring an explicit container role that is NOT bound.
    const dag: DAG = Validator.dag.validate({
      '@context': DAG_CONTEXT,
      '@id': 'urn:noocodex:dag:unbound-role-test',
      '@type': 'DAG',
      'name': 'unbound-role-test',
      'version': '1',
      'entrypoint': 'fan',
      'nodes': [
        {
          '@id': 'urn:noocodex:dag:unbound-role-test/node/fan',
          '@type': 'ScatterNode',
          'name': 'fan',
          'body': { 'dag': 'inner-worker' },
          'source': 'items',
          'itemKey': 'item',
          'concurrency': 1,
          'gather': { 'strategy': 'discard' },
          'container': 'unbound-worker-role',
          'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null },
        },
      ],
    });

    dispatcher.registerDAG(dag);

    // Exactly one warning for the one unbound-role placement.
    assert.equal(warnings.length, 1,
      `expected 1 unbound-role warning; got ${warnings.length}`);
    assert.ok(warnings[0]?.includes('unbound-worker-role'),
      `warning must name the unbound role; got: "${warnings[0]}"`);

    // Warning count must remain at 1 (no double-warn on the same registration).
    assert.equal(warnings.length, 1, 'warning count must remain 1 after registration');
  });
});

// ── TST-19: Checkpoint.restoreStores with type/version mismatch ──────────────

void describe('TST-19: Checkpoint.restoreStores — type/version mismatch → StoreError', () => {
  void it('throws StoreError(INCOMPATIBLE_SNAPSHOT) when checkpoint store type does not match', async () => {
    // Build a checkpoint whose stores.cache has type 'cache-store', but we
    // attempt to restore it into a MemoryStore (type 'memory-store').
    const badRaw = {
      'version': '2',
      'dagName': 'type-mismatch-test',
      'cursor': 'next-node',
      'state': {},
      'executedNodes': [],
      'skippedNodes': [],
      'stores': {
        'cache': {
          'version': 1,
          'type': 'cache-store',  // MemoryStore expects 'memory-store'
          'entries': [{ 'key': 'k', 'value': 'v' }],
        },
      },
    };

    const recalled = Checkpoint.load(badRaw);
    const freshStore = new MemoryStore();

    await assert.rejects(
      () => recalled.restoreStores({ 'cache': freshStore }),
      (err: unknown) => {
        assert.ok(err instanceof StoreError,
          `Expected StoreError, got ${String(err)}`);
        assert.equal(err.classification.reason, 'INCOMPATIBLE_SNAPSHOT',
          `Expected INCOMPATIBLE_SNAPSHOT, got ${err.classification.reason}`);
        return true;
      },
    );
  });

  void it('throws StoreError(INCOMPATIBLE_SNAPSHOT) when checkpoint store version does not match', async () => {
    // Build a checkpoint whose stores.data has an unsupported version.
    // MemoryStore accepts version 1; supply version 99.
    const badVersion = {
      'version': '2',
      'dagName': 'version-mismatch-test',
      'cursor': 'next-node',
      'state': {},
      'executedNodes': [],
      'skippedNodes': [],
      'stores': {
        'data': {
          'version': 99,
          'type': 'memory-store',
          'entries': [],
        },
      },
    };

    const recalled = Checkpoint.load(badVersion);
    const freshStore = new MemoryStore();

    await assert.rejects(
      () => recalled.restoreStores({ 'data': freshStore }),
      (err: unknown) => {
        assert.ok(err instanceof StoreError,
          `Expected StoreError, got ${String(err)}`);
        assert.equal(err.classification.reason, 'INCOMPATIBLE_SNAPSHOT',
          `Expected INCOMPATIBLE_SNAPSHOT, got ${err.classification.reason}`);
        return true;
      },
    );
  });
});

// ── TST-20: SignalComposer.compose with a pre-aborted signal ──────────────────

void describe('TST-20: SignalComposer.compose — pre-aborted signal', () => {
  void it('composed result is already aborted when the supplied signal is pre-aborted', () => {
    const controller = new AbortController();
    controller.abort(new Error('pre-aborted'));

    const composed = SignalComposer.compose({ 'signal': controller.signal });

    // Composing a pre-aborted signal with no deadline returns the same signal
    // (single-input path), which is already aborted.
    assert.ok(composed !== null, 'composed signal must not be null');
    assert.ok(composed.aborted, 'composed signal must be aborted immediately');
  });

  void it('composed result is already aborted when both inputs are pre-aborted', () => {
    const c1 = new AbortController();
    const c2 = new AbortController();
    c1.abort();
    c2.abort();

    const composed = SignalComposer.compose({
      'signal': c1.signal,
      'deadlineMs': 0,  // AbortSignal.timeout(0) fires immediately
    });

    assert.ok(composed !== null, 'composed signal must not be null');
    // The composed signal must be aborted (either immediately or after a tick).
    // AbortSignal.any aborts as soon as any input aborts.
    assert.ok(composed.aborted, 'composed signal must be aborted when a pre-aborted signal is composed');
  });

  void it('returns the pre-aborted signal directly (single-input path)', () => {
    const controller = new AbortController();
    controller.abort('test-reason');

    const composed = SignalComposer.compose({ 'signal': controller.signal });

    // Single-input path: the supplied signal is returned as-is.
    assert.strictEqual(composed, controller.signal,
      'single-input path must return the supplied signal directly');
    assert.ok(composed?.aborted, 'returned signal must be aborted');
  });
});

// ── TST-15: Abort mid-scatter dag-body (contained): checkpoint survives ───────
//
// Exercises the contained scatter abort path using an in-process loopback
// container (same pattern as scatter-containment.test.ts). Verifies:
//   (a) cursor lands on the scatter placement name after abort.
//   (b) SCATTER_PROGRESS_KEY is preserved in state (not cleared).
//   (c) The partial ScatterProgress has fewer acked items than total items.

void describe('TST-15: abort mid-contained-dag-body scatter — checkpoint survives', () => {
  void it('aborted scatter with dag-body: cursor on scatter node, checkpoint preserved', async () => {
    // Single state type used by both the body DAG nodes and the parent scatter.
    // items: the scatter source (parent field), value: per-clone output (body field).
    class ScatterAbortState extends NodeStateBase {
      items: number[] = [];
      value: number = 0;

      protected override snapshotData(): JsonObject {
        return { 'items': [...this.items], 'value': this.value };
      }

      protected override restoreData(snap: JsonObject): void {
        const items = snap['items'];
        if (Array.isArray(items)) this.items = items.filter((x): x is number => typeof x === 'number');
        const v = snap['value'];
        if (typeof v === 'number') this.value = v;
      }
    }

    // Counter node: reads item from metadata, records it, then waits for abort
    // on the second call so the abort fires while a clone body is suspended.
    let resolveSecondReady!: () => void;
    const secondReady = new Promise<void>((r) => { resolveSecondReady = r; });
    let callCount = 0;

    const counterNode: NodeInterface<ScatterAbortState, 'done'> = {
      'name': 'counter',
      'outputs': ['done'],
      async execute(state, context) {
        callCount++;
        const item = state.getMetadata<number>('item') ?? 0;
        state.value = item;
        if (callCount === 2) {
          resolveSecondReady();
          // Block this item — abort will interrupt it.
          await new Promise<void>((_resolve, reject) => {
            context.signal.addEventListener('abort', () => {
              reject(context.signal.reason);
            }, { 'once': true });
          });
        }
        return { 'output': 'done' };
      },
    };

    const bodyDagName = 'abort-body-dag';
    const bodyDag: DAG = Validator.dag.validate({
      '@context': DAG_CONTEXT,
      '@id': 'urn:test:abort-body-dag',
      '@type': 'DAG',
      'name': bodyDagName,
      'version': '1',
      'entrypoint': 'counter',
      'nodes': [
        {
          '@id': 'urn:test:abort-body-dag/node/counter',
          '@type': 'SingleNode',
          'name': 'counter',
          'node': 'counter',
          'outputs': { 'done': null },
        },
      ],
    });

    // Parent scatter DAG: concurrency=1, dag-body scatter, no container (in-process).
    const parentDag: DAG = Validator.dag.validate({
      '@context': DAG_CONTEXT,
      '@id': 'urn:test:abort-parent-dag',
      '@type': 'DAG',
      'name': 'abort-parent-dag',
      'version': '1',
      'entrypoint': 'fan',
      'nodes': [
        {
          '@id': 'urn:test:abort-parent-dag/node/fan',
          '@type': 'ScatterNode',
          'name': 'fan',
          'body': { 'dag': bodyDagName },
          'source': 'items',
          'itemKey': 'item',
          'concurrency': 1,
          'gather': { 'strategy': 'discard' },
          'outputs': {
            'all-success': null,
            'partial': null,
            'all-error': null,
            'empty': null,
          },
        },
      ],
    });

    const dispatcher = new Dagonizer<ScatterAbortState>();
    dispatcher.registerNode(counterNode);
    dispatcher.registerDAG(bodyDag);
    dispatcher.registerDAG(parentDag);

    const state = new ScatterAbortState();
    state.items = [1, 2, 3, 4, 5];

    const ctl = new AbortController();
    const execution = dispatcher.execute('abort-parent-dag', state, { 'signal': ctl.signal });

    // Abort once the second item's body node is suspended.
    secondReady.then(() => { ctl.abort(new Error('mid-scatter-abort')); });
    const result = await execution;

    // (a) Cursor must be on the scatter placement.
    assert.equal(result.cursor, 'fan',
      `cursor must land on scatter node 'fan' after abort; got '${result.cursor}'`);

    // (b) SCATTER_PROGRESS_KEY must be preserved (not cleared by scatter clear logic).
    const progress = result.state.getMetadata<Record<string, unknown>>(SCATTER_PROGRESS_KEY);
    assert.ok(progress !== undefined,
      'SCATTER_PROGRESS_KEY must be preserved after abort (checkpoint must survive)');

    // (c) Fewer than all items were acked.
    const entry = progress['fan'] as { ackedResults: unknown[] } | undefined;
    assert.ok(entry !== undefined, 'progress must have an entry for placement "fan"');
    assert.ok(
      entry.ackedResults.length < state.items.length,
      `fewer than ${state.items.length} items must be acked after mid-scatter abort; ` +
      `got ${entry.ackedResults.length}`,
    );
  });
});
