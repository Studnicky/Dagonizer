import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, it } from 'node:test';

import { DagGraphTerms, GraphStateTerms } from '@studnicky/dagonizer/graph';

import { FileGraphDataset } from '../src/index.js';

void describe('FileGraphDataset durable adapter', () => {
  void it('reopens the durable file adapter from canonical N-Quads', () => {
    const directory = mkdtempSync(`${tmpdir()}/dagonizer-graph-`);
    const path = `${directory}/state.nq`;
    try {
      const source = new FileGraphDataset(path);
      const graph = DagGraphTerms.namedNode('urn:file:graph');
      source.add([{
        "subject": DagGraphTerms.namedNode('urn:file:subject'),
        "predicate": DagGraphTerms.namedNode('urn:file:predicate'),
        "object": DagGraphTerms.literal('durable'),
        graph,
      }]);

      const reopened = new FileGraphDataset(path);
      assert.equal(reopened.count({ "graph": graph }), 1);
      assert.equal([...reopened.match({ "graph": graph })][0]?.object.value, 'durable');
      assert.equal(reopened.count({ "graph": DagGraphTerms.namedNode(GraphStateTerms.revisionGraphIri()) }), 4);
      assert.match(reopened.revision(), /^graph-rev-[0-9a-f]{64}$/);
    } finally {
      rmSync(directory, { "recursive": true, "force": true });
    }
  });

  void it('keeps durable revisions stable across blank-node reopen and write', () => {
    const directory = mkdtempSync(`${tmpdir()}/dagonizer-graph-`);
    const path = `${directory}/blank-state.nq`;
    try {
      const source = new FileGraphDataset(path);
      const graph = DagGraphTerms.namedNode('urn:file:blank:graph');
      source.add([{
        "subject": { "termType": 'BlankNode', "value": 'source' },
        "predicate": DagGraphTerms.namedNode('urn:file:blank:predicate'),
        "object": DagGraphTerms.literal('durable'),
        graph,
      }]);

      const reopened = new FileGraphDataset(path);
      reopened.assert(
        DagGraphTerms.namedNode('urn:file:blank:subject'),
        DagGraphTerms.namedNode('urn:file:blank:predicate'),
        DagGraphTerms.literal('after-reopen'),
        graph,
      );
      assert.equal(reopened.count({ "graph": graph }), 2);
    } finally {
      rmSync(directory, { "recursive": true, "force": true });
    }
  });

  void it('persists durable RDF 1.2 triple terms and recomputes their revision', () => {
    const directory = mkdtempSync(`${tmpdir()}/dagonizer-graph-`);
    const path = `${directory}/triple-term-state.nq`;
    try {
      const source = new FileGraphDataset(path);
      const graph = DagGraphTerms.namedNode('urn:file:triple-term:graph');
      const triple = DagGraphTerms.tripleTerm(
        DagGraphTerms.namedNode('urn:file:triple-term:subject'),
        DagGraphTerms.namedNode('urn:file:triple-term:predicate'),
        { "termType": 'BlankNode', "value": 'inner' },
      );
      source.assert(
        DagGraphTerms.namedNode('urn:file:triple-term:annotation'),
        DagGraphTerms.namedNode('urn:file:triple-term:reifies'),
        triple,
        graph,
      );

      const reopened = new FileGraphDataset(path);
      assert.equal(reopened.count({ "graph": graph }), 1);
      assert.match(reopened.revision(), /^graph-rev-[0-9a-f]{64}$/u);
    } finally {
      rmSync(directory, { "recursive": true, "force": true });
    }
  });

  void it('journals direct durable writes without rewriting the snapshot', () => {
    const directory = mkdtempSync(`${tmpdir()}/dagonizer-graph-`);
    const path = `${directory}/journaled-state.nq`;
    try {
      const dataset = new FileGraphDataset(path);
      const graph = DagGraphTerms.namedNode('urn:file:journal:graph');
      dataset.assert(
        DagGraphTerms.namedNode('urn:file:journal:subject:0'),
        DagGraphTerms.namedNode('urn:file:journal:predicate'),
        DagGraphTerms.literal('0'),
        graph,
      );
      dataset.flush();
      const snapshot = readFileSync(path, 'utf8');
      for (let index = 1; index < 4; index += 1) {
        dataset.assert(
          DagGraphTerms.namedNode(`urn:file:journal:subject:${index}`),
          DagGraphTerms.namedNode('urn:file:journal:predicate'),
          DagGraphTerms.literal(String(index)),
          graph,
        );
      }
      assert.equal(readFileSync(path, 'utf8'), snapshot);
      assert.equal(existsSync(`${path}.journal`), true);
      dataset.flush();
      assert.equal(existsSync(path), true);
      assert.equal(existsSync(`${path}.journal`), false);
    } finally {
      rmSync(directory, { "recursive": true, "force": true });
    }
  });

  void it('rolls back durable graph transactions before the commit boundary', () => {
    const directory = mkdtempSync(`${tmpdir()}/dagonizer-graph-`);
    const path = `${directory}/transaction.nq`;
    try {
      const dataset = new FileGraphDataset(path);
      const graph = DagGraphTerms.namedNode('urn:file:transaction:graph');
      assert.throws(() => dataset.transact((transaction) => {
        transaction.assert(
          DagGraphTerms.namedNode('urn:file:transaction:subject'),
          DagGraphTerms.namedNode('urn:file:transaction:predicate'),
          DagGraphTerms.literal('partial'),
          graph,
        );
        throw new Error('durable transaction failed');
      }), /durable transaction failed/u);
      assert.equal(dataset.count({ "graph": graph }), 0);
      assert.equal(new FileGraphDataset(path).count({ "graph": graph }), 0);
    } finally {
      rmSync(directory, { "recursive": true, "force": true });
    }
  });
});
