import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Timing } from '@studnicky/timing';

import { BatchItemExecutor } from '../../src/execution/BatchItemExecutor.js';

void describe('BatchItemExecutor timing', () => {
  void it('records item lifecycle events through a consumer-supplied Timing sink', async () => {
    const timing = Timing.create();

    const result = await BatchItemExecutor.map(
      [1, 2],
      async (item) => item * 2,
      { 'concurrency': 2, timing },
    );

    assert.deepEqual(result, [2, 4]);
    const events = timing.getEvents();
    assert.equal(typeof events['batch.item.start'], 'number');
    assert.equal(typeof events['batch.item.complete'], 'number');
  });
});
