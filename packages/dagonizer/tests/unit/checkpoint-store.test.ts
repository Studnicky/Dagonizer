import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Checkpoint, MemoryCheckpointStore } from '../../src/checkpoint/index.js';
import type { CheckpointData } from '../../src/entities/index.js';
import { ValidationError } from '../../src/errors/index.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

class StoreState extends NodeStateBase {
  value = 0;
  protected override snapshotData(): { value: number } {
    return { 'value': this.value };
  }
  protected override restoreData(snap: Record<string, unknown>): void {
    if (typeof snap['value'] === 'number') this.value = snap['value'];
  }
}

const SAMPLE_CHECKPOINT: CheckpointData = {
  'version': '1',
  'dagName': 'demo',
  'cursor': 'next-node',
  'state': { 'metadata': {}, 'errors': [], 'warnings': [], 'value': 7 },
  'executedNodes': ['first'],
  'skippedNodes': [],
  'stores': {},
};

void describe('MemoryCheckpointStore', () => {
  void it('save then load returns the persisted JSON', async () => {
    const store = new MemoryCheckpointStore();
    await store.save('k', '{"hello":1}');
    assert.equal(await store.load('k'), '{"hello":1}');
  });

  void it('load returns null when key is absent', async () => {
    const store = new MemoryCheckpointStore();
    assert.equal(await store.load('missing'), null);
  });

  void it('delete removes the entry', async () => {
    const store = new MemoryCheckpointStore();
    await store.save('k', 'x');
    await store.delete('k');
    assert.equal(await store.load('k'), null);
    assert.equal(store.size, 0);
  });
});

void describe('ckpt.persist + Checkpoint.recall', () => {
  void it('round-trips a checkpoint through a CheckpointStore', async () => {
    const cpStore = new MemoryCheckpointStore();
    const ckpt = Checkpoint.load(SAMPLE_CHECKPOINT);
    await ckpt.persist(cpStore, 'demo:1');

    const recalled = await Checkpoint.recall(cpStore, 'demo:1');
    assert.ok(recalled !== null);

    const { dagName, cursor, state, executedNodes } = recalled.restoreState<StoreState>(
      (snap) => StoreState.restore(snap),
    );
    assert.equal(dagName, 'demo');
    assert.equal(cursor, 'next-node');
    assert.equal(state.value, 7);
    assert.deepEqual([...executedNodes], ['first']);
  });

  void it('recall returns null when no entry exists', async () => {
    const cpStore = new MemoryCheckpointStore();
    const recalled = await Checkpoint.recall(cpStore, 'missing');
    assert.equal(recalled, null);
  });

  void it('recall throws ValidationError on malformed JSON', async () => {
    const cpStore = new MemoryCheckpointStore();
    await cpStore.save('bad', '{not json');
    await assert.rejects(
      Checkpoint.recall(cpStore, 'bad'),
      ValidationError,
    );
  });
});
