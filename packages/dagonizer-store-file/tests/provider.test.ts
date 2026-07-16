import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, it } from 'node:test';

import { DagGraphTerms } from '@studnicky/dagonizer/graph';

import { FileGraphDataset, FileGraphDatasetProvider } from '../src/index.js';

void describe('FileGraphDatasetProvider', () => {
  void it('reopens a durable root with its RDF facts intact', async () => {
    const directory = mkdtempSync(`${tmpdir()}/dagonizer-file-provider-`);
    try {
      const provider = new FileGraphDatasetProvider(directory);
      const graph = provider.root('urn:dagonizer:run:file-provider');
      const subject = DagGraphTerms.namedNode('urn:dagonizer:subject');
      graph.assert(subject, DagGraphTerms.namedNode('urn:dagonizer:predicate'), DagGraphTerms.literal('value'));

      const reopened = await provider.reopen('urn:dagonizer:run:file-provider');
      assert.ok(reopened instanceof FileGraphDataset);
      assert.equal(reopened.count({ 'subject': subject }), 1);
    } finally {
      rmSync(directory, { 'recursive': true, 'force': true });
    }
  });

  void it('keeps root identity stable and leaves children volatile by default', () => {
    const directory = mkdtempSync(`${tmpdir()}/dagonizer-file-provider-`);
    try {
      const provider = new FileGraphDatasetProvider(directory);
      const root = provider.root('urn:dagonizer:run:stable');
      assert.equal(provider.root('urn:dagonizer:run:stable'), root);
      const child = provider.child(
        { 'runIri': 'urn:dagonizer:run:stable', 'dagIri': 'urn:dagonizer:dag', 'placementIri': 'urn:dagonizer:placement' },
        { 'runIri': 'urn:dagonizer:run:stable/child', 'dagIri': 'urn:dagonizer:dag', 'placementIri': 'urn:dagonizer:child' },
      );
      assert.equal(child instanceof FileGraphDataset, false);
      assert.equal(child.count({}), 0);
    } finally {
      rmSync(directory, { 'recursive': true, 'force': true });
    }
  });
});
