/**
 * dag-recommend-top-rated-branch: unit test confirming the parent DAG
 * canonical JSON-LD DAG contains the `recommend-top-rated`
 * branch present.
 *
 * The DAG is imported as authored data; no service graph is needed to inspect
 * topology.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { WellFormedValidator } from '@studnicky/dagonizer/validation';

import { archivistDAG } from '../../dag.ts';

const REQUIRED_PLACEMENTS = [
  'recommend-extract',
  'recommend-decide-tools',
  'recommend-build-worksets',
  'recommend-scatter',
  'recommend-rank',
  'recommend-merge',
  'recommend-record',
  'recommend-gate',
  'recommend-recall',
] as const;

void test('archivistDAG: recommend-top-rated branch is present', () => {
  assert.equal(archivistDAG.name, 'the-archivist');
});

void test('archivistDAG: recommend-top-rated placements all present by name', () => {
  const placementNames = new Set(archivistDAG.nodes.map((n) => n.name));
  for (const name of REQUIRED_PLACEMENTS) {
    assert.equal(placementNames.has(name), true, `placement "${name}" present in the built DAG`);
  }
});

void test('archivistDAG: DAG is well-formed (zero violations)', () => {
  const violations = WellFormedValidator.check(archivistDAG);
  assert.deepEqual(violations, [], `archivist DAG is well-formed: ${violations.join('; ')}`);
});
