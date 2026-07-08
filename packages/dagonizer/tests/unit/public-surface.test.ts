import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GATHER_PROGRESS_KEY } from '../../src/entities/constants/ProgressKey.js';
import { GATHER_PROGRESS_KEY as ROOT_GATHER_PROGRESS_KEY } from '../../src/index.js';

void describe('public root surface', () => {
  void it('exports the first-class gather progress key', () => {
    assert.equal(ROOT_GATHER_PROGRESS_KEY, GATHER_PROGRESS_KEY);
  });
});
