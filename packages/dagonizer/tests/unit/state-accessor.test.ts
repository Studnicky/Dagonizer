import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { StateAccessorInterface } from '../../src/contracts/StateAccessorInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAGType } from '../../src/entities/index.js';
import type { JsonObjectType } from '../../src/entities/json.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { DottedPathAccessor } from '../../src/runtime/DottedPathAccessor.js';
import { StateMapper } from '../../src/runtime/StateMapper.js';
import { TestNode } from '../_support/TestNode.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

// Subclass with a domain field and NO clone() override; snapshot/restore the field.
class DomainState extends NodeStateBase {
  domainValue: number;

  constructor() {
    super();
    this.domainValue = 0;
  }

  protected override snapshotData(): JsonObjectType {
    return { 'domainValue': this.domainValue };
  }

  protected override restoreData(snap: Record<string, unknown>): void {
    const v = snap['domainValue'];
    if (typeof v === 'number') this.domainValue = v;
  }
}

// Minimal metadata-backed StateAccessorInterface for the StateMapper path.
const metadataAccessor: StateAccessorInterface = {
  get<T = unknown>(state: NodeStateBase, key: string): T | null {
    return state.getMetadata<T>(key) ?? null;
  },
  set(state: NodeStateBase, key: string, value: unknown): void {
    state.setMetadata(key, value);
  },
};

// ── DottedPathAccessor: get/set semantics + prototype-pollution defense ──────

void describe('DottedPathAccessor', () => {
  void it('reads a top-level field', () => {
    const accessor = new DottedPathAccessor();
    assert.equal(accessor.get({ 'a': 1 }, 'a'), 1);
  });

  void it('reads a nested field via dotted path', () => {
    const accessor = new DottedPathAccessor();
    assert.equal(accessor.get({ 'a': { 'b': { 'c': 42 } } }, 'a.b.c'), 42);
  });

  void it('returns null for a missing path', () => {
    const accessor = new DottedPathAccessor();
    assert.equal(accessor.get({}, 'a.b.c'), null);
  });

  void it('writes a top-level field', () => {
    const accessor = new DottedPathAccessor();
    const target: Record<string, unknown> = {};
    accessor.set(target, 'a', 1);
    assert.equal(target['a'], 1);
  });

  void it('creates intermediate objects on nested write', () => {
    const accessor = new DottedPathAccessor();
    const target: Record<string, unknown> = {};
    accessor.set(target, 'a.b.c', 'value');
    assert.deepEqual(target, { 'a': { 'b': { 'c': 'value' } } });
  });

  void it('refuses to write through __proto__ (no prototype pollution)', () => {
    const accessor = new DottedPathAccessor();
    accessor.set({}, '__proto__.polluted', 'yes');
    accessor.set({}, 'a.__proto__.polluted', 'yes');
    accessor.set({}, 'constructor.prototype.polluted', 'yes');
    const freshObj: Record<string, unknown> = {};
    assert.equal(freshObj['polluted'], undefined);
    assert.equal(Reflect.get(Object.prototype, 'polluted'), undefined);
  });

  void it('returns null for a path that walks a prototype key', () => {
    const accessor = new DottedPathAccessor();
    assert.equal(accessor.get({ 'a': 1 }, '__proto__'), null);
    assert.equal(accessor.get({ 'a': 1 }, 'a.constructor'), null);
  });
});

// ── Dagonizer custom StateAccessorInterface injection ─────────────────────────────────

void describe('Dagonizer accepts a custom StateAccessorInterface', () => {
  void it('uses the supplied accessor for scatter source reads', async () => {
    let getCalls = 0;
    const trackingAccessor: StateAccessorInterface = {
      get<T = unknown>(state: object, path: string): T | null {
        getCalls += 1;
        return new DottedPathAccessor().get<T>(state, path);
      },
      set(state: object, path: string, value: unknown): void {
        new DottedPathAccessor().set(state, path, value);
      },
    };

    class ScatterState extends NodeStateBase {
      items: number[] = [10, 20, 30];
      results: number[] = [];
    }

    const dispatcher = new Dagonizer<ScatterState>({ 'accessor': trackingAccessor });
    dispatcher.registerNode(TestNode.make<ScatterState>('handler', ['success'], (state) => {
      const item = state.getMetadata<number>('item') ?? 0;
      state.results.push(item * 2);
      return 'success';
    }));
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:fan-test',
      '@type':    'DAG',
      'name': 'fan-test',
      'version': '1',
      'entrypoint': 'fan',
      'nodes': [{
        '@id':    'urn:noocodex:dag:fan-test/node/fan',
        '@type':  'ScatterNode',
        'name':   'fan',
        'body':   { 'node': 'handler' },
        'source': 'items',
        'itemKey': 'item',
        'gather': { 'strategy': 'append', 'target': 'collected' },
        'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
      },
        { '@id': 'urn:noocodex:dag:fan-test/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    dispatcher.registerDAG(dag);

    await dispatcher.execute('fan-test', new ScatterState());

    assert.ok(getCalls > 0, 'custom accessor.get was invoked at least once');
  });
});

// ── NodeStateBase.clone() + StateMapper.cloneChild subclass identity ────────

void describe('NodeStateBase.clone() subclass identity', () => {
  void it('clone() returns an instance of the concrete subclass', () => {
    const state = new DomainState();
    state.domainValue = 42;

    const cloned = state.clone();

    assert.ok(
      cloned instanceof DomainState,
      `Expected cloned to be instanceof DomainState, got ${cloned.constructor.name}`,
    );
  });

  void it('domain field round-trips through clone + applySnapshot (restoreData runs)', () => {
    const state = new DomainState();
    state.domainValue = 99;

    const cloned = state.clone();
    // Domain field starts at default (0) in the fresh clone — it hasn't been
    // populated yet. After applySnapshot with the original snapshot, restoreData
    // runs and restores the field.
    assert.strictEqual(cloned.domainValue, 0, 'fresh clone should have default domainValue');

    const snap = state.snapshot();
    cloned.applySnapshot(snap);

    assert.strictEqual(cloned.domainValue, 99, 'domainValue must survive clone→applySnapshot round-trip');
  });

  void it('metadata is preserved; lifecycle and errors reset on clone', () => {
    const state = new DomainState();
    state.setMetadata('key', 'value');
    state.domainValue = 7;

    const cloned = state.clone();

    // Metadata crosses the clone boundary.
    assert.strictEqual(cloned.getMetadata('key'), 'value', 'metadata must be preserved in clone');

    // Lifecycle resets to pending.
    assert.strictEqual(cloned.lifecycle.variant, 'pending', 'lifecycle must reset to pending');

    // Errors start empty.
    assert.strictEqual(cloned.errors.length, 0, 'errors must be empty in clone');
  });

  void it('StateMapper.cloneChild produces a correctly-typed subclass instance with mapped metadata', () => {
    const mapper = new StateMapper(metadataAccessor);
    const parent = new DomainState();
    parent.domainValue = 55;
    parent.setMetadata('item', 3);

    const child = mapper.cloneChild(parent, { 'item': 'item' });

    assert.ok(
      child instanceof DomainState,
      `Expected child from StateMapper.cloneChild to be instanceof DomainState, got ${child.constructor.name}`,
    );
    // Metadata input-mapping is applied.
    assert.strictEqual(child.getMetadata('item'), 3, 'input mapping must propagate metadata to child');
    // Domain field starts at default (not copied from parent — base clone semantics).
    assert.strictEqual(child.domainValue, 0, 'domain field starts at default; not carried from parent');
  });
});
