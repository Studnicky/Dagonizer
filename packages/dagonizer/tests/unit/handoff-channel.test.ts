/**
 * handoff-channel.test.ts
 *
 * W5 hand-off channels:
 * (a) DAG ending at a BOUND terminal publishes exactly one envelope; round-trip
 *     fixed point: restore(envelope.stateSnapshot).snapshot() deep-equals
 *     envelope.stateSnapshot.
 * (b) DAG ending at an UNBOUND terminal publishes nothing.
 * (c) Channel whose publish rejects → run returns normal ExecutionResult with
 *     unchanged terminalOutcome, and state.errors contains HANDOFF_PUBLISH_FAILED.
 * (d) Embedded/contained child DAG ending at a terminal does NOT publish — only
 *     the top-level run publishes.
 * (e) DAGHandoffType schema validation: value-variant valid; ref-variant valid;
 *     both-present invalid; neither-present invalid; additionalProperties invalid.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryChannel } from '../../src/channels/InMemoryChannel.js';
import type { HandoffChannelInterface } from '../../src/contracts/HandoffChannelInterface.js';
import { ScalarNode } from '../../src/core/ScalarNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAGHandoffType } from '../../src/entities/handoff/DAGHandoff.js';
import type { DAGType } from '../../src/entities/index.js';
import type { JsonObjectType } from '../../src/entities/json.js';
import type { NodeOutputType } from '../../src/entities/node/NodeOutput.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { Validator } from '../../src/validation/Validator.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

class HandoffState extends NodeStateBase {
  counter = 0;

  override clone(): this {
    const cloned = new (this.constructor as new () => this)();
    cloned.counter = this.counter;
    return cloned;
  }

  protected override snapshotData() {
    return { 'counter': this.counter };
  }

  protected override restoreData(snap: Record<string, unknown>) {
    const v = snap['counter'];
    if (typeof v === 'number') this.counter = v;
  }
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

class IncrementNode extends ScalarNode<HandoffState, 'next'> {
  readonly name = 'increment';
  readonly outputs = ['next'] as const;
  protected async executeOne(state: HandoffState): Promise<NodeOutputType<'next'>> {
    state.counter += 1;
    return { 'errors': [], 'output': 'next' as const };
  }
}

class NoopNode extends ScalarNode<HandoffState, 'done'> {
  readonly name = 'noop';
  readonly outputs = ['done'] as const;
  protected async executeOne(_state: HandoffState): Promise<NodeOutputType<'done'>> {
    return { 'errors': [], 'output': 'done' as const };
  }
}

const incrementNode = new IncrementNode();
const noopNode = new NoopNode();

// ---------------------------------------------------------------------------
// DAG helpers
// ---------------------------------------------------------------------------

function makeSimpleDAG(dagName: string, terminalName: string, outcome: 'completed' | 'failed'): DAGType {
  return {
    '@context': DAG_CONTEXT,
    '@id': `urn:noocodex:dag:${dagName}`,
    '@type': 'DAG',
    'name': dagName,
    'version': '1',
    'entrypoint': 'increment',
    'nodes': [
      {
        '@id': `urn:noocodex:dag:${dagName}/node/increment`,
        '@type': 'SingleNode',
        'name': 'increment',
        'node': 'increment',
        'outputs': { 'next': terminalName },
      },
      {
        '@id': `urn:noocodex:dag:${dagName}/node/${terminalName}`,
        '@type': 'TerminalNode',
        'name': terminalName,
        'outcome': outcome,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// (a) Bound terminal publishes one envelope; round-trip fixed point
// ---------------------------------------------------------------------------

void describe('handoff-channel: bound terminal', () => {
  void it('publishes exactly one envelope with state snapshot', async () => {
    const channel = new InMemoryChannel();
    const dag = makeSimpleDAG('handoff-bound', 'done', 'completed');
    const dispatcher = new Dagonizer<HandoffState>({
      'channels': { 'done': channel },
      'registryVersion': '1.2.3',
    });
    dispatcher.registerNode(incrementNode);
    dispatcher.registerDAG(dag);

    const state = new HandoffState();
    const result = await dispatcher.execute('handoff-bound', state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(channel.published.length, 1);

    const envelope = channel.published[0] as DAGHandoffType;
    assert.equal(envelope.dagName, 'handoff-bound');
    assert.equal(envelope.terminalName, 'done');
    assert.equal(envelope.terminalOutput, 'completed');
    assert.equal(envelope.registryVersion, '1.2.3');
    assert.ok(envelope.correlationId.length > 0);
    assert.deepEqual(envelope.placementPath, []);
    assert.ok('stateSnapshot' in envelope, 'envelope should have stateSnapshot');
    assert.ok(!('stateSnapshotRef' in envelope), 'envelope should not have stateSnapshotRef');

    // Round-trip fixed point: restore → snapshot must equal original snapshot
    const byValueEnvelope = envelope as { stateSnapshot: JsonObjectType };
    const originalSnapshot = byValueEnvelope.stateSnapshot;
    const restored = HandoffState.restore(originalSnapshot);
    const restoredSnapshot = restored.snapshot();
    assert.deepEqual(restoredSnapshot, originalSnapshot);
  });

  void it('envelope state reflects node mutations (counter incremented)', async () => {
    const channel = new InMemoryChannel();
    const dag = makeSimpleDAG('handoff-counter', 'done', 'completed');
    const dispatcher = new Dagonizer<HandoffState>({
      'channels': { 'done': channel },
    });
    dispatcher.registerNode(incrementNode);
    dispatcher.registerDAG(dag);

    const state = new HandoffState();
    await dispatcher.execute('handoff-counter', state);

    assert.equal(channel.published.length, 1);
    const envelope = channel.published[0] as DAGHandoffType;
    assert.ok('stateSnapshot' in envelope);
    const snap = (envelope as { stateSnapshot: JsonObjectType }).stateSnapshot;
    assert.equal((snap as { counter?: number }).counter, 1);
  });
});

// ---------------------------------------------------------------------------
// (b) Unbound terminal publishes nothing
// ---------------------------------------------------------------------------

void describe('handoff-channel: unbound terminal', () => {
  void it('publishes nothing when terminal is not in channels', async () => {
    const channel = new InMemoryChannel();
    const dag = makeSimpleDAG('handoff-unbound', 'done', 'completed');
    // channels does NOT include 'done'
    const dispatcher = new Dagonizer<HandoffState>({
      'channels': { 'other': channel },
    });
    dispatcher.registerNode(incrementNode);
    dispatcher.registerDAG(dag);

    const state = new HandoffState();
    const result = await dispatcher.execute('handoff-unbound', state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(channel.published.length, 0);
  });

  void it('publishes nothing when channels option is empty', async () => {
    const channel = new InMemoryChannel();
    const dag = makeSimpleDAG('handoff-empty-channels', 'done', 'completed');
    const dispatcher = new Dagonizer<HandoffState>();
    dispatcher.registerNode(incrementNode);
    dispatcher.registerDAG(dag);

    const state = new HandoffState();
    await dispatcher.execute('handoff-empty-channels', state);

    assert.equal(channel.published.length, 0);
  });
});

// ---------------------------------------------------------------------------
// (c) Publish failure: HANDOFF_PUBLISH_FAILED collected; terminalOutcome unchanged
// ---------------------------------------------------------------------------

void describe('handoff-channel: publish failure', () => {
  void it('collects HANDOFF_PUBLISH_FAILED when channel.publish rejects', async () => {
    const failingChannel: HandoffChannelInterface = {
      async publish() {
        throw new Error('transport down');
      },
    };

    const dag = makeSimpleDAG('handoff-fail', 'done', 'completed');
    const dispatcher = new Dagonizer<HandoffState>({
      'channels': { 'done': failingChannel },
    });
    dispatcher.registerNode(incrementNode);
    dispatcher.registerDAG(dag);

    const state = new HandoffState();
    const result = await dispatcher.execute('handoff-fail', state);

    // terminalOutcome unchanged
    assert.equal(result.terminalOutcome, 'completed');
    // lifecycle still completed
    assert.equal(result.state.lifecycle.variant, 'completed');
    // error collected in state
    const handoffErr = state.errors.find((e) => e.code === 'HANDOFF_PUBLISH_FAILED');
    assert.ok(handoffErr !== undefined, 'HANDOFF_PUBLISH_FAILED error should be collected');
    assert.equal(handoffErr.recoverable, false);
    assert.equal(handoffErr.operation, 'done');
  });
});

// ---------------------------------------------------------------------------
// (d) Embedded child DAG does NOT publish
// ---------------------------------------------------------------------------

void describe('handoff-channel: embedded child does not publish', () => {
  void it('does not publish from an embedded child DAG run', async () => {
    const channel = new InMemoryChannel();

    // child DAG: single node → terminal 'done'
    const childDag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id': 'urn:noocodex:dag:handoff-child',
      '@type': 'DAG',
      'name': 'handoff-child',
      'version': '1',
      'entrypoint': 'noop',
      'nodes': [
        {
          '@id': 'urn:noocodex:dag:handoff-child/node/noop',
          '@type': 'SingleNode',
          'name': 'noop',
          'node': 'noop',
          'outputs': { 'done': 'child-done' },
        },
        {
          '@id': 'urn:noocodex:dag:handoff-child/node/child-done',
          '@type': 'TerminalNode',
          'name': 'child-done',
          'outcome': 'completed',
        },
      ],
    };

    // parent DAG: embeds the child, then reaches own terminal
    const parentDag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id': 'urn:noocodex:dag:handoff-parent',
      '@type': 'DAG',
      'name': 'handoff-parent',
      'version': '1',
      'entrypoint': 'embed',
      'nodes': [
        {
          '@id': 'urn:noocodex:dag:handoff-parent/node/embed',
          '@type': 'EmbeddedDAGNode',
          'name': 'embed',
          'dag': 'handoff-child',
          'outputs': { 'success': 'parent-done' },
        },
        {
          '@id': 'urn:noocodex:dag:handoff-parent/node/parent-done',
          '@type': 'TerminalNode',
          'name': 'parent-done',
          'outcome': 'completed',
        },
      ],
    };

    // Bind 'child-done' terminal to the channel — it MUST NOT publish (embedded)
    // Also bind 'parent-done' terminal to the channel — it MUST publish (top-level)
    const dispatcher = new Dagonizer<HandoffState>({
      'channels': {
        'child-done': channel,
        'parent-done': channel,
      },
    });
    dispatcher.registerNode(noopNode);
    dispatcher.registerDAG(childDag);
    dispatcher.registerDAG(parentDag);

    const state = new HandoffState();
    await dispatcher.execute('handoff-parent', state);

    // Only ONE publish: the top-level parent-done terminal.
    // The embedded child-done terminal must not publish.
    assert.equal(channel.published.length, 1);
    assert.equal((channel.published[0] as DAGHandoffType).terminalName, 'parent-done');
  });
});

// ---------------------------------------------------------------------------
// (e) DAGHandoffType schema validation
// ---------------------------------------------------------------------------

void describe('handoff-channel: DAGHandoffType schema', () => {
  void it('validates a by-value envelope', () => {
    const envelope: unknown = {
      'dagName': 'test-dag',
      'terminalName': 'done',
      'terminalOutput': 'completed',
      'registryVersion': '1.0.0',
      'correlationId': 'test-dag:1',
      'placementPath': [],
      'stateSnapshot': { 'metadata': {} },
    };
    assert.ok(Validator.dagHandoff.is(envelope), 'by-value envelope should be valid');
  });

  void it('validates a by-reference envelope', () => {
    const envelope: unknown = {
      'dagName': 'test-dag',
      'terminalName': 'done',
      'terminalOutput': 'completed',
      'registryVersion': '1.0.0',
      'correlationId': 'test-dag:1',
      'placementPath': ['parent'],
      'stateSnapshotRef': 's3://my-bucket/snapshots/abc123',
    };
    assert.ok(Validator.dagHandoff.is(envelope), 'by-ref envelope should be valid');
  });

  void it('rejects an envelope with both stateSnapshot and stateSnapshotRef', () => {
    const envelope: unknown = {
      'dagName': 'test-dag',
      'terminalName': 'done',
      'terminalOutput': 'completed',
      'registryVersion': '1.0.0',
      'correlationId': 'test-dag:1',
      'placementPath': [],
      'stateSnapshot': { 'metadata': {} },
      'stateSnapshotRef': 's3://bucket/key',
    };
    assert.ok(!Validator.dagHandoff.is(envelope), 'both fields should be invalid');
  });

  void it('rejects an envelope with neither stateSnapshot nor stateSnapshotRef', () => {
    const envelope: unknown = {
      'dagName': 'test-dag',
      'terminalName': 'done',
      'terminalOutput': 'completed',
      'registryVersion': '1.0.0',
      'correlationId': 'test-dag:1',
      'placementPath': [],
    };
    assert.ok(!Validator.dagHandoff.is(envelope), 'neither field should be invalid');
  });

  void it('rejects an envelope with additionalProperties', () => {
    const envelope: unknown = {
      'dagName': 'test-dag',
      'terminalName': 'done',
      'terminalOutput': 'completed',
      'registryVersion': '1.0.0',
      'correlationId': 'test-dag:1',
      'placementPath': [],
      'stateSnapshot': {},
      'extraField': 'not-allowed',
    };
    assert.ok(!Validator.dagHandoff.is(envelope), 'additionalProperties should be invalid');
  });

  void it('rejects an envelope with empty dagName', () => {
    const envelope: unknown = {
      'dagName': '',
      'terminalName': 'done',
      'terminalOutput': 'completed',
      'registryVersion': '1.0.0',
      'correlationId': 'test-dag:1',
      'placementPath': [],
      'stateSnapshot': {},
    };
    assert.ok(!Validator.dagHandoff.is(envelope), 'empty dagName should be invalid');
  });

  void it('rejects an envelope with empty correlationId', () => {
    const envelope: unknown = {
      'dagName': 'test-dag',
      'terminalName': 'done',
      'terminalOutput': 'completed',
      'registryVersion': '1.0.0',
      'correlationId': '',
      'placementPath': [],
      'stateSnapshot': {},
    };
    assert.ok(!Validator.dagHandoff.is(envelope), 'empty correlationId should be invalid');
  });
});

// ---------------------------------------------------------------------------
// InMemoryChannel.onPublished hook (extension via subclass, zero callbacks)
// ---------------------------------------------------------------------------

void describe('InMemoryChannel: onPublished hook', () => {
  void it('invokes onPublished after recording the envelope', async () => {
    const received: DAGHandoffType[] = [];
    class RecordingChannel extends InMemoryChannel {
      protected override async onPublished(handoff: DAGHandoffType): Promise<void> {
        received.push(handoff);
      }
    }
    const channel = new RecordingChannel();
    const dag = makeSimpleDAG('handoff-hook', 'done', 'completed');
    const dispatcher = new Dagonizer<HandoffState>({
      'channels': { 'done': channel },
    });
    dispatcher.registerNode(incrementNode);
    dispatcher.registerDAG(dag);

    await dispatcher.execute('handoff-hook', new HandoffState());

    assert.equal(channel.published.length, 1);
    assert.equal(received.length, 1);
    // The hook receives the same deep-cloned envelope stored in published
    assert.deepEqual(received[0] as DAGHandoffType, channel.published[0] as DAGHandoffType);
  });

  void it('publishErrors collects errors thrown by onPublished; envelope still recorded', async () => {
    class ThrowingChannel extends InMemoryChannel {
      protected override async onPublished(_handoff: DAGHandoffType): Promise<void> {
        throw new Error('hook-failure');
      }
    }
    const channel = new ThrowingChannel();
    const dag = makeSimpleDAG('handoff-throw', 'done', 'completed');
    const dispatcher = new Dagonizer<HandoffState>({
      'channels': { 'done': channel },
    });
    dispatcher.registerNode(incrementNode);
    dispatcher.registerDAG(dag);

    await dispatcher.execute('handoff-throw', new HandoffState());

    // Envelope is still recorded (publish() records before calling hook).
    assert.equal(channel.published.length, 1);
    // Error is collected, not swallowed silently.
    assert.equal(channel.publishErrors.length, 1);
    assert.equal(channel.publishErrors[0]?.message, 'hook-failure');
  });

  void it('publishErrors is empty when onPublished succeeds', async () => {
    const channel = new InMemoryChannel();
    const dag = makeSimpleDAG('handoff-no-error', 'done', 'completed');
    const dispatcher = new Dagonizer<HandoffState>({
      'channels': { 'done': channel },
    });
    dispatcher.registerNode(incrementNode);
    dispatcher.registerDAG(dag);

    await dispatcher.execute('handoff-no-error', new HandoffState());

    assert.equal(channel.publishErrors.length, 0);
  });
});
