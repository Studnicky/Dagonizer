import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { StateAccessor } from '../../src/contracts/StateAccessor.js';
import type { JsonObject } from '../../src/entities/json.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { StateMapper } from '../../src/runtime/StateMapper.js';

// ---------------------------------------------------------------------------
// Fixture: subclass with a domain field and NO clone() override
// ---------------------------------------------------------------------------

class DomainState extends NodeStateBase {
  domainValue: number;

  constructor() {
    super();
    this.domainValue = 0;
  }

  protected override snapshotData(): JsonObject {
    return { 'domainValue': this.domainValue };
  }

  protected override restoreData(snap: Record<string, unknown>): void {
    const v = snap['domainValue'];
    if (typeof v === 'number') this.domainValue = v;
  }
}

// ---------------------------------------------------------------------------
// Minimal StateAccessor for StateMapper path
// ---------------------------------------------------------------------------

const metadataAccessor: StateAccessor = {
  get<T = unknown>(state: NodeStateBase, key: string): T | undefined {
    return state.getMetadata<T>(key);
  },
  set(state: NodeStateBase, key: string, value: unknown): void {
    state.setMetadata(key, value);
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void describe('NodeStateBase.clone() subclass identity', () => {
  void it('(a) clone() returns an instance of the concrete subclass', () => {
    const state = new DomainState();
    state.domainValue = 42;

    const cloned = state.clone();

    assert.ok(
      cloned instanceof DomainState,
      `Expected cloned to be instanceof DomainState, got ${cloned.constructor.name}`,
    );
  });

  void it('(b) domain field round-trips through clone + applySnapshot (restoreData runs)', () => {
    const state = new DomainState();
    state.domainValue = 99;

    const cloned = state.clone() as DomainState;
    // Domain field starts at default (0) in the fresh clone — it hasn't been
    // populated yet. After applySnapshot with the original snapshot, restoreData
    // must run and restore the field.
    assert.strictEqual(cloned.domainValue, 0, 'fresh clone should have default domainValue');

    const snap = state.snapshot();
    cloned.applySnapshot(snap);

    assert.strictEqual(cloned.domainValue, 99, 'domainValue must survive clone→applySnapshot round-trip');
  });

  void it('(c) metadata is preserved; lifecycle and errors reset on clone', () => {
    const state = new DomainState();
    state.setMetadata('key', 'value');
    state.domainValue = 7;

    const cloned = state.clone() as DomainState;

    // Metadata crosses the clone boundary
    assert.strictEqual(cloned.getMetadata('key'), 'value', 'metadata must be preserved in clone');

    // Lifecycle resets to pending
    assert.strictEqual(cloned.lifecycle.kind, 'pending', 'lifecycle must reset to pending');

    // Errors start empty
    assert.strictEqual(cloned.errors.length, 0, 'errors must be empty in clone');
  });

  void it('(d) StateMapper.createChild produces a correctly-typed subclass instance', () => {
    const mapper = new StateMapper<DomainState>(metadataAccessor);
    const parent = new DomainState();
    parent.domainValue = 55;
    parent.setMetadata('item', 3);

    const child = mapper.createChild(parent, { 'item': 'item' });

    assert.ok(
      child instanceof DomainState,
      `Expected child from StateMapper.createChild to be instanceof DomainState, got ${child.constructor.name}`,
    );
    // Metadata input-mapping was applied
    assert.strictEqual(child.getMetadata('item'), 3, 'input mapping must propagate metadata to child');
    // Domain field starts at default (not copied from parent — base clone semantics)
    assert.strictEqual(child.domainValue, 0, 'domain field starts at default; not carried from parent');
  });
});
