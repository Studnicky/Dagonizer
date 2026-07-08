import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GATHER_PROGRESS_KEY } from '../../src/entities/constants/ProgressKey.js';
import {
  GATHER_PROGRESS_KEY as ROOT_GATHER_PROGRESS_KEY,
  GatherCheckpoint,
  GatherProgressSchema,
  GatherRecordProgressSchema,
  WellFormedValidator,
} from '../../src/index.js';
import type {
  GatherProgressType as RootGatherProgressType,
  GatherRecordProgressType as RootGatherRecordProgressType,
} from '../../src/index.js';
import type {
  GatherProgressType as TypeBarrelGatherProgressType,
  GatherRecordProgressType as TypeBarrelGatherRecordProgressType,
} from '../../src/types/index.js';

void describe('public root surface', () => {
  void it('exports the first-class gather progress key', () => {
    assert.equal(ROOT_GATHER_PROGRESS_KEY, GATHER_PROGRESS_KEY);
  });

  void it('exports first-class gather checkpoint and progress schemas', () => {
    const progress: RootGatherProgressType = { 'entries': {} };
    const sameProgress: TypeBarrelGatherProgressType = progress;
    const record: RootGatherRecordProgressType = {
      'source': 'left',
      'index': null,
      'output': 'success',
      'terminalOutcome': null,
      'snapshot': {},
    };
    const sameRecord: TypeBarrelGatherRecordProgressType = record;

    assert.deepEqual(sameProgress, { 'entries': {} });
    assert.equal(sameRecord.source, 'left');
    assert.equal(GatherProgressSchema.properties.entries.type, 'object');
    assert.equal(GatherRecordProgressSchema.properties.source.type, 'string');
    assert.equal(typeof GatherCheckpoint.read, 'function');
  });

  void it('exports the authored-DAG well-formed validator', () => {
    assert.equal(typeof WellFormedValidator.check, 'function');
  });
});
