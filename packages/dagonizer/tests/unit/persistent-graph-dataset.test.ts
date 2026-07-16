import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DagGraphTerms } from '../../src/graph/DagGraphTerms.js';
import { PersistentGraphDataset } from '../../src/graph/PersistentGraphDataset.js';
import { MemoryGraphJournal } from '../_support/MemoryGraphJournal.js';

const RUN_IRI = 'urn:dagonizer:run:persistent-dataset';

void describe('PersistentGraphDataset', () => {
  void it('reopen round-trips named nodes, literals, named graphs, RDF 1.2 triple terms, and blank nodes', async () => {
    const journal = new MemoryGraphJournal();
    const dataset = new PersistentGraphDataset(RUN_IRI, journal);
    const graph = DagGraphTerms.namedNode('urn:dagonizer:named-graph');
    const blank = { 'termType': 'BlankNode' as const, 'value': 'b0' };
    const quoted = DagGraphTerms.quadTerm({
      'subject': DagGraphTerms.namedNode('urn:dagonizer:quoted-s'),
      'predicate': DagGraphTerms.namedNode('urn:dagonizer:quoted-p'),
      'object': DagGraphTerms.literal('quoted-o'),
      'graph': DagGraphTerms.defaultGraph(),
    });

    dataset.assert(DagGraphTerms.namedNode('urn:dagonizer:s1'), DagGraphTerms.namedNode('urn:dagonizer:p1'), DagGraphTerms.literal('plain-literal'));
    dataset.assert(DagGraphTerms.namedNode('urn:dagonizer:s2'), DagGraphTerms.namedNode('urn:dagonizer:p2'), DagGraphTerms.literal('42', 'http://www.w3.org/2001/XMLSchema#integer'), graph);
    dataset.assert(DagGraphTerms.namedNode('urn:dagonizer:s3'), DagGraphTerms.namedNode('urn:dagonizer:p3'), quoted);
    dataset.assert(blank, DagGraphTerms.namedNode('urn:dagonizer:p4'), DagGraphTerms.literal('blank-object'));
    assert.equal(dataset.count({}), 4);
    await dataset.flush();

    const reopened = await PersistentGraphDataset.reopen(RUN_IRI, journal);
    assert.equal(reopened.count({}), 4);
    assert.equal(reopened.count({ 'graph': graph }), 1);
    assert.equal(reopened.match({ 'object': quoted }).next().done, false);
    const blankMatches = [...reopened.match({ 'predicate': DagGraphTerms.namedNode('urn:dagonizer:p4') })];
    assert.equal(blankMatches.length, 1);
    assert.equal(blankMatches[0]?.subject.termType, 'BlankNode');
  });

  void it('delete-then-reopen leaves a blank-node quad gone (no resurrection across the N-Quads round-trip)', async () => {
    const journal = new MemoryGraphJournal();
    const dataset = new PersistentGraphDataset(RUN_IRI, journal);
    const blank = { 'termType': 'BlankNode' as const, 'value': 'b0' };
    const predicate = DagGraphTerms.namedNode('urn:dagonizer:blank-predicate');
    const object = DagGraphTerms.literal('blank-object');

    dataset.assert(blank, predicate, object);
    await dataset.flush();
    dataset.delete({ 'subject': blank, predicate, object });
    await dataset.flush();
    assert.equal(dataset.count({}), 0);

    const reopened = await PersistentGraphDataset.reopen(RUN_IRI, journal);
    assert.equal(reopened.count({}), 0);
  });

  void it('a delta append rejection surfaces on flush() and does not silently drop', async () => {
    const journal = new MemoryGraphJournal();
    const dataset = new PersistentGraphDataset(RUN_IRI, journal);

    journal.failNextAppend = true;
    dataset.assert(DagGraphTerms.namedNode('urn:dagonizer:s'), DagGraphTerms.namedNode('urn:dagonizer:p'), DagGraphTerms.literal('first'));
    await assert.rejects(() => dataset.flush(), /Simulated journal append failure/u);

    // The dataset is marked degraded: a second mutation's flush also surfaces
    // the terminal error rather than resuming as if nothing happened.
    dataset.assert(DagGraphTerms.namedNode('urn:dagonizer:s2'), DagGraphTerms.namedNode('urn:dagonizer:p2'), DagGraphTerms.literal('second'));
    await assert.rejects(() => dataset.flush(), /Simulated journal append failure/u);

    // The synchronous working set itself is unaffected by the durability failure.
    assert.equal(dataset.count({}), 2);
  });

  void it('flush-before-close persists pending deltas', async () => {
    const journal = new MemoryGraphJournal();
    const dataset = new PersistentGraphDataset(RUN_IRI, journal);
    dataset.assert(DagGraphTerms.namedNode('urn:dagonizer:close-s'), DagGraphTerms.namedNode('urn:dagonizer:close-p'), DagGraphTerms.literal('close-o'));

    // No await between the mutation and flush(): flush() must wait for the
    // queued write-behind append, not just whatever has already settled.
    await dataset.flush();
    assert.equal(journal.logs.get(RUN_IRI)?.length, 1);

    const reopened = await PersistentGraphDataset.reopen(RUN_IRI, journal);
    assert.equal(reopened.count({}), 1);
  });

  void it('compaction preserves exact state and drops the compacted log prefix', async () => {
    const journal = new MemoryGraphJournal();
    const dataset = new PersistentGraphDataset(RUN_IRI, journal);
    const predicate = DagGraphTerms.namedNode('urn:dagonizer:compact-p');

    dataset.assert(DagGraphTerms.namedNode('urn:dagonizer:compact-s1'), predicate, DagGraphTerms.literal('one'));
    dataset.assert(DagGraphTerms.namedNode('urn:dagonizer:compact-s2'), predicate, DagGraphTerms.literal('two'));
    await dataset.flush();
    assert.equal(journal.logs.get(RUN_IRI)?.length, 2);

    await dataset.compact();
    assert.equal(journal.logs.get(RUN_IRI)?.length, 0);
    assert.ok((journal.snapshots.get(RUN_IRI)?.length ?? 0) > 0);

    dataset.delete({ 'subject': DagGraphTerms.namedNode('urn:dagonizer:compact-s1'), predicate });
    dataset.assert(DagGraphTerms.namedNode('urn:dagonizer:compact-s3'), predicate, DagGraphTerms.literal('three'));
    await dataset.flush();

    const reopened = await PersistentGraphDataset.reopen(RUN_IRI, journal);
    assert.equal(reopened.count({}), 2);
    assert.equal(reopened.count({ 'subject': DagGraphTerms.namedNode('urn:dagonizer:compact-s1') }), 0);
    assert.equal(reopened.count({ 'subject': DagGraphTerms.namedNode('urn:dagonizer:compact-s2') }), 1);
    assert.equal(reopened.count({ 'subject': DagGraphTerms.namedNode('urn:dagonizer:compact-s3') }), 1);
  });
});
