/**
 * Frontier unit tests.
 *
 * Verifies the Frontier data structure: merge/concat ordering, take, pickReady
 * rank/decl-index tie-breaking, and isEmpty.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Batch } from '../../src/core/batch/Batch.js';
import { Frontier } from '../../src/core/Frontier.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

void describe('Frontier', () => {
  void it('is empty after construction', () => {
    const frontier = new Frontier<NodeStateBase>();
    assert.equal(frontier.isEmpty(), true);
    assert.equal(frontier.size, 0);
  });

  void it('merge adds a new placement entry', () => {
    const frontier = new Frontier<NodeStateBase>();
    const s = new NodeStateBase();
    frontier.merge('a', Batch.of(s));
    assert.equal(frontier.isEmpty(), false);
    assert.equal(frontier.size, 1);
  });

  void it('merge concatenates items when placement already present — order preserved', () => {
    const frontier = new Frontier<NodeStateBase>();
    const s1 = new NodeStateBase();
    const s2 = new NodeStateBase();
    s1.setMetadata('idx', 1);
    s2.setMetadata('idx', 2);

    frontier.merge('a', Batch.of(s1, 'item1'));
    frontier.merge('a', Batch.of(s2, 'item2'));

    const batch = frontier.peek('a');
    assert.ok(batch !== undefined);
    assert.equal(batch.size, 2);
    // Original item is first; merged item is second.
    assert.equal(batch.row(0).id, 'item1');
    assert.equal(batch.row(1).id, 'item2');
    assert.equal(batch.row(0).state.getMetadata('idx'), 1);
    assert.equal(batch.row(1).state.getMetadata('idx'), 2);
  });

  void it('take removes and returns the batch', () => {
    const frontier = new Frontier<NodeStateBase>();
    const s = new NodeStateBase();
    frontier.merge('a', Batch.of(s));
    const taken = frontier.take('a');
    assert.ok(taken !== undefined);
    assert.equal(taken.size, 1);
    assert.equal(frontier.isEmpty(), true);
  });

  void it('take returns undefined for missing placement', () => {
    const frontier = new Frontier<NodeStateBase>();
    assert.equal(frontier.take('nonexistent'), undefined);
  });

  void it('pickReady returns null when frontier is empty', () => {
    const frontier = new Frontier<NodeStateBase>();
    const result = frontier.pickReady(() => 0, () => 0);
    assert.equal(result, null);
  });

  void it('pickReady returns the lowest-rank placement', () => {
    const frontier = new Frontier<NodeStateBase>();
    frontier.merge('a', Batch.of(new NodeStateBase()));
    frontier.merge('b', Batch.of(new NodeStateBase()));
    frontier.merge('c', Batch.of(new NodeStateBase()));

    const ranks: Record<string, number> = { 'a': 2, 'b': 0, 'c': 1 };
    const decls: Record<string, number> = { 'a': 0, 'b': 1, 'c': 2 };

    const picked = frontier.pickReady((n) => ranks[n] ?? 99, (n) => decls[n] ?? 99);
    assert.equal(picked, 'b');
  });

  void it('pickReady breaks rank ties with lowest declaration index', () => {
    const frontier = new Frontier<NodeStateBase>();
    frontier.merge('x', Batch.of(new NodeStateBase()));
    frontier.merge('y', Batch.of(new NodeStateBase()));

    // Both rank 5; x has decl index 10, y has decl index 3 → y wins.
    const ranks: Record<string, number> = { 'x': 5, 'y': 5 };
    const decls: Record<string, number> = { 'x': 10, 'y': 3 };

    const picked = frontier.pickReady((n) => ranks[n] ?? 99, (n) => decls[n] ?? 99);
    assert.equal(picked, 'y');
  });

  void it('peek does not remove the batch', () => {
    const frontier = new Frontier<NodeStateBase>();
    const s = new NodeStateBase();
    frontier.merge('a', Batch.of(s));
    const peeked = frontier.peek('a');
    assert.ok(peeked !== undefined);
    assert.equal(frontier.isEmpty(), false);
    // Still present after peek.
    assert.equal(frontier.size, 1);
  });

  void it('multiple merges across different placements tracked independently', () => {
    const frontier = new Frontier<NodeStateBase>();
    frontier.merge('left', Batch.of(new NodeStateBase(), 'l1'));
    frontier.merge('right', Batch.of(new NodeStateBase(), 'r1'));
    frontier.merge('left', Batch.of(new NodeStateBase(), 'l2'));

    assert.equal(frontier.size, 2);
    const left = frontier.peek('left');
    const right = frontier.peek('right');
    assert.ok(left !== undefined);
    assert.ok(right !== undefined);
    assert.equal(left.size, 2);
    assert.equal(right.size, 1);
  });
});
