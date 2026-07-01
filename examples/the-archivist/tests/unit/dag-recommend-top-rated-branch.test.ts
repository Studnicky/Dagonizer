/**
 * dag-recommend-top-rated-branch: unit test confirming the parent DAG
 * (`ArchivistBundleFactory.create`) builds and validates with the
 * `recommend-top-rated` branch present.
 *
 * Mirrors the stub-services pattern in `dag-validate.ts`: every
 * `LlmClientInterface` method is an unused rejected stub since no method is
 * called during DAG construction.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { WellFormedValidator } from '@studnicky/dagonizer/validation';

import { ArchivistBundleFactory } from '../../dag.ts';
import { ArchivistNodes } from '../../nodes/ArchivistNodes.ts';
import { MemoryStore } from '../../memory/MemoryStore.ts';
import type { ArchivistServices } from '../../services.ts';

const STUB_DEFINITION = {
  'name': 'stub', 'description': '', 'inputSchema': { 'type': 'object' as const },
  'outputSchema': { 'type': 'object' as const }, 'strict': false,
} satisfies ArchivistServices['webSearch']['definition'];

class NullTool {
  readonly definition = STUB_DEFINITION;
  async execute(): Promise<never> { return Promise.reject(new Error('stub')); }
}

class NullLlm {
  async classifyIntent(): Promise<never>       { return Promise.reject(new Error('stub')); }
  async extractTerms(): Promise<never>         { return Promise.reject(new Error('stub')); }
  async decideTools(): Promise<never>          { return Promise.reject(new Error('stub')); }
  async rankCandidates(): Promise<never>       { return Promise.reject(new Error('stub')); }
  async compose(): Promise<never>              { return Promise.reject(new Error('stub')); }
  async composeAuthor(): Promise<never>        { return Promise.reject(new Error('stub')); }
  async composeReviews(): Promise<never>       { return Promise.reject(new Error('stub')); }
  async describeBook(): Promise<never>         { return Promise.reject(new Error('stub')); }
  async composeSimilar(): Promise<never>       { return Promise.reject(new Error('stub')); }
  async validate(): Promise<never>             { return Promise.reject(new Error('stub')); }
  async composeMemoryRecall(): Promise<never>  { return Promise.reject(new Error('stub')); }
  async composeEmptyResponse(): Promise<never> { return Promise.reject(new Error('stub')); }
  async suggestStarterQuery(): Promise<never>  { return Promise.reject(new Error('stub')); }
  async suggestGreeting(): Promise<never>      { return Promise.reject(new Error('stub')); }
  async suggestVisitorReplyTo(): Promise<never> { return Promise.reject(new Error('stub')); }
  async explainTool(): Promise<never>          { return Promise.reject(new Error('stub')); }
}

const stubServices: ArchivistServices = {
  'webSearch':        new NullTool(),
  'googleBooks':      new NullTool(),
  'subjectSearch':    new NullTool(),
  'wikipediaSummary': new NullTool(),
  'llm':              new NullLlm(),
  'memory':           new MemoryStore(),
  'embedder':         null,
  'nodeTimeouts':     {},
};

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

void test('ArchivistBundleFactory: builds with the recommend-top-rated branch present', () => {
  const stubNodes = ArchivistNodes.build(stubServices);
  const archivistDAG = ArchivistBundleFactory.create(stubNodes).dags[0];
  assert.notEqual(archivistDAG, undefined, 'archivist DAG present in the bundle');
});

void test('ArchivistBundleFactory: recommend-top-rated placements all present by name', () => {
  const stubNodes = ArchivistNodes.build(stubServices);
  const archivistDAG = ArchivistBundleFactory.create(stubNodes).dags[0];
  if (archivistDAG === undefined) throw new Error('dag not found in bundle');

  const placementNames = new Set(archivistDAG.nodes.map((n) => n.name));
  for (const name of REQUIRED_PLACEMENTS) {
    assert.equal(placementNames.has(name), true, `placement "${name}" present in the built DAG`);
  }
});

void test('ArchivistBundleFactory: archivist DAG is well-formed (zero violations)', () => {
  const stubNodes = ArchivistNodes.build(stubServices);
  const archivistDAG = ArchivistBundleFactory.create(stubNodes).dags[0];
  if (archivistDAG === undefined) throw new Error('dag not found in bundle');

  const violations = WellFormedValidator.check(archivistDAG);
  assert.deepEqual(violations, [], `archivist DAG is well-formed: ${violations.join('; ')}`);
});
