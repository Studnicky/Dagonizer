/**
 * WorkSet unit tests.
 *
 * Verifies the WorkSet data structure: add/concat ordering, take, nextReady
 * rank/decl-index tie-breaking, and isEmpty.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Batch } from '../../src/core/batch/Batch.js';
import { WorkSet } from '../../src/core/WorkSet.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

void describe('WorkSet', () => {
  void it('is empty after construction', () => {
    const pending = new WorkSet<NodeStateBase>();
    assert.equal(pending.isEmpty(), true);
    assert.equal(pending.size, 0);
  });

  void it('add creates a new node entry', () => {
    const pending = new WorkSet<NodeStateBase>();
    const s = new NodeStateBase();
    pending.add('a', Batch.of(s));
    assert.equal(pending.isEmpty(), false);
    assert.equal(pending.size, 1);
  });

  void it('add concatenates items when the node already holds work — order preserved', () => {
    const pending = new WorkSet<NodeStateBase>();
    const s1 = new NodeStateBase();
    const s2 = new NodeStateBase();
    s1.setMetadata('idx', 1);
    s2.setMetadata('idx', 2);

    pending.add('a', Batch.of(s1, 'item1'));
    pending.add('a', Batch.of(s2, 'item2'));

    const batch = pending.peek('a');
    assert.ok(batch !== undefined);
    assert.equal(batch.size, 2);
    // Original item is first; added item is second.
    assert.equal(batch.row(0).id, 'item1');
    assert.equal(batch.row(1).id, 'item2');
    assert.equal(batch.row(0).state.getMetadata('idx'), 1);
    assert.equal(batch.row(1).state.getMetadata('idx'), 2);
  });

  void it('take removes and returns the batch', () => {
    const pending = new WorkSet<NodeStateBase>();
    const s = new NodeStateBase();
    pending.add('a', Batch.of(s));
    const taken = pending.take('a');
    assert.ok(taken !== undefined);
    assert.equal(taken.size, 1);
    assert.equal(pending.isEmpty(), true);
  });

  void it('take returns undefined for a node with no pending work', () => {
    const pending = new WorkSet<NodeStateBase>();
    assert.equal(pending.take('nonexistent'), undefined);
  });

  void it('nextReady returns null when the work set is empty', () => {
    const pending = new WorkSet<NodeStateBase>();
    const result = pending.nextReady(() => 0, () => 0);
    assert.equal(result, null);
  });

  void it('nextReady returns the lowest-rank node', () => {
    const pending = new WorkSet<NodeStateBase>();
    pending.add('a', Batch.of(new NodeStateBase()));
    pending.add('b', Batch.of(new NodeStateBase()));
    pending.add('c', Batch.of(new NodeStateBase()));

    const ranks: Record<string, number> = { 'a': 2, 'b': 0, 'c': 1 };
    const decls: Record<string, number> = { 'a': 0, 'b': 1, 'c': 2 };

    const picked = pending.nextReady((n) => ranks[n] ?? 99, (n) => decls[n] ?? 99);
    assert.equal(picked, 'b');
  });

  void it('nextReady breaks rank ties with lowest declaration index', () => {
    const pending = new WorkSet<NodeStateBase>();
    pending.add('x', Batch.of(new NodeStateBase()));
    pending.add('y', Batch.of(new NodeStateBase()));

    // Both rank 5; x has decl index 10, y has decl index 3 → y wins.
    const ranks: Record<string, number> = { 'x': 5, 'y': 5 };
    const decls: Record<string, number> = { 'x': 10, 'y': 3 };

    const picked = pending.nextReady((n) => ranks[n] ?? 99, (n) => decls[n] ?? 99);
    assert.equal(picked, 'y');
  });

  void it('peek does not remove the batch', () => {
    const pending = new WorkSet<NodeStateBase>();
    const s = new NodeStateBase();
    pending.add('a', Batch.of(s));
    const peeked = pending.peek('a');
    assert.ok(peeked !== undefined);
    assert.equal(pending.isEmpty(), false);
    // Still present after peek.
    assert.equal(pending.size, 1);
  });

  void it('work across different nodes is tracked independently', () => {
    const pending = new WorkSet<NodeStateBase>();
    pending.add('left', Batch.of(new NodeStateBase(), 'l1'));
    pending.add('right', Batch.of(new NodeStateBase(), 'r1'));
    pending.add('left', Batch.of(new NodeStateBase(), 'l2'));

    assert.equal(pending.size, 2);
    const left = pending.peek('left');
    const right = pending.peek('right');
    assert.ok(left !== undefined);
    assert.ok(right !== undefined);
    assert.equal(left.size, 2);
    assert.equal(right.size, 1);
  });
});
