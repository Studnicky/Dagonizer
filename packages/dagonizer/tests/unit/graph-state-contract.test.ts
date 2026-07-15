import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GraphStateTerms } from '../../src/graph/GraphStateTerms.js';

void describe('GraphStateTerms', () => {
  void it('exposes the project vocabulary as a namespace', () => {
    assert.equal(GraphStateTerms.DAGONIZER.PlacementExecution, 'https://noocodec.dev/ontology/dagonizer/PlacementExecution');
    assert.equal(GraphStateTerms.DAGONIZER.namespace, 'https://noocodec.dev/ontology/dagonizer/');
  });

  void it('derives stable run-scoped graph identities', () => {
    const run = 'urn:dagonizer:run:42';
    assert.equal(GraphStateTerms.runGraphIri(run), 'urn:dagonizer:run:42#state');
    assert.equal(
      GraphStateTerms.placementExecutionIri(run, 'urn:dagonizer:dag:demo/node/step'),
      'urn:dagonizer:run:42/placement/urn%3Adagonizer%3Adag%3Ademo%2Fnode%2Fstep',
    );
    assert.equal(
      GraphStateTerms.stateCellIri(run, 'metadata.correlationKey'),
      'urn:dagonizer:run:42#state/state/metadata.correlationKey',
    );
  });

  void it('derives checkpoint, workset, and item identities without collisions', () => {
    const run = 'urn:dagonizer:run:42';
    const checkpoint = GraphStateTerms.checkpointIri(run, 'checkpoint/0');
    const workset = GraphStateTerms.worksetIri(run, 'scatter');
    assert.equal(checkpoint, 'urn:dagonizer:run:42/checkpoint/checkpoint%2F0');
    assert.equal(GraphStateTerms.batchItemIri(workset, 7), `${workset}/item/7`);
    assert.notEqual(checkpoint, GraphStateTerms.checkpointIri(run, 'checkpoint-0'));
  });
});
