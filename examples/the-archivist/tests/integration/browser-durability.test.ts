/**
 * browser-durability.test.ts: IndexedDB durability and HITL park/reload/resume.
 *
 * Exercises the full round-trip:
 *   1. Execute a DAG that parks (empty query → ParkForInputNode).
 *   2. Capture checkpoint + store snapshot to fake IndexedDB.
 *   3. Simulate reload: drop references, open fresh stores.
 *   4. Recall checkpoint, restore stores + state, set query.
 *   5. Resume dispatcher and assert lifecycle completed.
 *   6. Assert that a triple written before park is present in freshMemory.
 *
 * `fake-indexeddb/auto` installs a fake IDB implementation on globalThis so
 * `IndexedDbStore.open()` / `IndexedDbCheckpointStore.open()` resolve the
 * real factory path (Reflect.get + IdbFactory.is) without a browser.
 *
 * Node 24 type-stripping: no enums, no namespaces, no parameter properties.
 */

import 'fake-indexeddb/auto';

import { describe, it, before, type SuiteContext, type TestContext } from 'node:test';
import assert from 'node:assert/strict';

import { Dagonizer } from '@studnicky/dagonizer';
import { ToolRegistry } from '@studnicky/dagonizer/tool';
import { Checkpoint, CheckpointRestoreAdapter } from '@studnicky/dagonizer/checkpoint';
import { IndexedDbCheckpointStore } from '@studnicky/dagonizer-store-indexeddb';

import { ArchivistState } from '../../ArchivistState.ts';
import { ArchivistNodes } from '../../nodes/ArchivistNodes.ts';
import { ArchivistBundleFactory } from '../../dag.ts';
import { BookSearchScatterBundleFactory } from '../../embedded-dags/BookSearchScatterDAG.ts';
import { ComposeRetryLoopBundleFactory } from '../../embedded-dags/ComposeRetryLoopDAG.ts';
import { MemoryStore } from '../../memory/MemoryStore.ts';
import type { ArchivistServices, ClassifiedIntent, LlmClientInterface } from '../../services.ts';
import type { CandidateType } from '../../entities/Book.ts';

// ── Stub tool definition ──────────────────────────────────────────────────

const STUB_DEFINITION = {
  'name':         'stub',
  'description':  '',
  'inputSchema':  { 'type': 'object' as const },
  'outputSchema': { 'type': 'object' as const },
  'strict':       false,
} satisfies ArchivistServices['webSearch']['definition'];

// ── Never-called null stubs ───────────────────────────────────────────────

class NullTool {
  readonly definition = STUB_DEFINITION;
  async execute(): Promise<never> {
    return Promise.reject(new Error('NullTool.execute: should not be called'));
  }
}

class EmptyScoutTool {
  readonly definition: typeof STUB_DEFINITION & { name: string };

  constructor(toolName: string) {
    this.definition = {
      'name':         toolName,
      'description':  `${toolName} stub — returns empty candidates`,
      'inputSchema':  { 'type': 'object' as const },
      'outputSchema': { 'type': 'object' as const },
      'strict':       false,
    };
  }

  async execute(): Promise<readonly CandidateType[]> {
    return [];
  }
}

// ── Stub LLM: classifyIntent returns 'search', all else rejects. ──────────

class StubLlmForHitl implements LlmClientInterface {
  async classifyIntent(): Promise<ClassifiedIntent> { return 'search'; }

  async extractTerms(): Promise<readonly string[]> {
    return ['book', 'library'];
  }

  async decideTools(): Promise<ReadonlyArray<{ name: string; arguments: Record<string, unknown> }>> {
    return [{ 'name': 'web_search_books', 'arguments': { 'query': 'book library' } }];
  }

  async rankCandidates(_query: string, candidates: readonly CandidateType[]): Promise<readonly { candidate: CandidateType; score: number }[]> {
    return candidates.map((c) => ({ 'candidate': c, 'score': c.score }));
  }

  async compose(): Promise<never>                   { return Promise.reject(new Error('not called')); }
  async composeAuthor(): Promise<never>             { return Promise.reject(new Error('not called')); }
  async composeReviews(): Promise<never>            { return Promise.reject(new Error('not called')); }
  async describeBook(): Promise<never>              { return Promise.reject(new Error('not called')); }
  async composeSimilar(): Promise<never>            { return Promise.reject(new Error('not called')); }
  async validate(): Promise<never>                  { return Promise.reject(new Error('not called')); }
  async composeMemoryRecall(): Promise<never>       { return Promise.reject(new Error('not called')); }

  async composeEmptyResponse(): Promise<never> {
    return Promise.reject(new Error('StubLlmForHitl: simulated LLM failure → triggers salvage'));
  }

  async suggestStarterQuery(): Promise<string>      { return 'What books do you recommend?'; }
  async suggestGreeting(): Promise<string>          { return 'Welcome to the archive.'; }
  async suggestVisitorReplyTo(): Promise<string>    { return 'Tell me more.'; }
  async explainTool(): Promise<string>              { return 'This tool searches for books.'; }
}

// ── Harness ───────────────────────────────────────────────────────────────

/**
 * ArchivistHitlHarness: builds a Dagonizer with all archivist bundles.
 * Shared by both the park phase and the resume phase of the test.
 */
class ArchivistHitlHarness {
  private constructor() { /* static-only */ }

  static dispatcher(llm: LlmClientInterface, memory: MemoryStore): Dagonizer<ArchivistState> {
    const services: ArchivistServices = {
      'webSearch':        new NullTool(),
      'googleBooks':      new NullTool(),
      'wikipediaSummary': new NullTool(),
      'subjectSearch':    new NullTool(),
      'llm':              llm,
      'memory':           memory,
      'embedder':         null,
      'nodeTimeouts':     {},
    };

    const dispatcher = new Dagonizer<ArchivistState>();

    const toolRegistry = new ToolRegistry();
    toolRegistry.register(new EmptyScoutTool('web_search_books'));
    toolRegistry.register(new EmptyScoutTool('google_books_search'));
    toolRegistry.register(new EmptyScoutTool('subject_search'));
    toolRegistry.register(new EmptyScoutTool('wikipedia_summary'));
    dispatcher.registerBundle(toolRegistry.bundle());

    const nodes = ArchivistNodes.build(services);
    dispatcher.registerBundle(BookSearchScatterBundleFactory.create(nodes));
    dispatcher.registerBundle(ComposeRetryLoopBundleFactory.create(nodes));
    dispatcher.registerBundle(ArchivistBundleFactory.create(nodes));

    return dispatcher;
  }
}

// ── Test suite ────────────────────────────────────────────────────────────

describe('Browser durability: IndexedDB park / reload / resume', () => {
  let correlationKey: string;
  let ckptStoreA: IndexedDbCheckpointStore;

  // Park phase ───────────────────────────────────────────────────────────────

  describe('park phase: empty query parks the flow', () => {
    before(async (_c: SuiteContext) => {
      // Use a unique DB name to avoid object-store conflicts between this
      // suite's checkpoint store and any shared 'dagonizer' DB.
      ckptStoreA = IndexedDbCheckpointStore.open(
        { 'databaseName': 'test-durability-ckpt', 'storeName': 'checkpoints' },
      );
      await ckptStoreA.connect();
    }, { 'timeout': 60_000 });

    it('parks with correlationKey "archivist-hitl"', { 'timeout': 60_000 }, async (_t: TestContext) => {
      const memory = new MemoryStore();

      // Write a test triple BEFORE the park so we can verify it survives the
      // checkpoint round-trip.
      memory.assert(
        MemoryStore.iri('urn:test:subject'),
        MemoryStore.iri('urn:test:pred'),
        MemoryStore.lit.str('hello'),
      );

      const llm = new StubLlmForHitl();
      const dispatcher = ArchivistHitlHarness.dispatcher(llm, memory);

      // Empty query triggers ParkForInputNode to park.
      const state = new ArchivistState();
      state.query = '';

      const execution = dispatcher.execute('the-archivist', state);
      for await (const _stage of execution) { /* drain */ }
      const result = await execution;

      assert.notEqual(result.parked, null, 'result.parked must be non-null after park');
      if (result.parked === null) return; // narrowing for TS

      assert.equal(
        result.parked.correlationKey,
        'archivist-hitl',
        'correlationKey must be "archivist-hitl"',
      );

      correlationKey = result.parked.correlationKey;

      // Capture checkpoint with memory store snapshot.
      const ckpt = await Checkpoint.capture('the-archivist', result, { 'stores': { 'memory': memory } });

      // Persist to IndexedDB.
      await ckpt.persist(ckptStoreA, correlationKey);

      // Verify checkpoint is stored.
      const loaded = await ckptStoreA.load(correlationKey);
      assert.notEqual(loaded, null, 'checkpoint JSON must be stored in IndexedDB');
    });
  });

  // Reload + resume phase ────────────────────────────────────────────────────

  describe('resume phase: reload from fresh stores, set query, resume', () => {
    before(async (_c: SuiteContext) => {
      // Simulate a page reload: the original memory and dispatcher references
      // are gone. Open fresh stores against the same fake IDB instance.
      if (typeof correlationKey !== 'string' || correlationKey.length === 0) {
        throw new Error('park phase must run before resume phase');
      }
    }, { 'timeout': 60_000 });

    it('restores memory triple from checkpoint and completes on resume', { 'timeout': 60_000 }, async (_t: TestContext) => {
      // Fresh checkpoint store (same fake IDB, same DB name as phase 1).
      const freshCkptStore = IndexedDbCheckpointStore.open(
        { 'databaseName': 'test-durability-ckpt', 'storeName': 'checkpoints' },
      );
      await freshCkptStore.connect();

      // Recall checkpoint.
      const recalled = await Checkpoint.recall(freshCkptStore, correlationKey);
      assert.notEqual(recalled, null, 'Checkpoint.recall must return a non-null checkpoint');
      if (recalled === null) return;

      // Fresh memory store for the restore target.
      const freshMemory = new MemoryStore();

      // Restore stores (memory snapshot rides in checkpoint).
      await recalled.restoreStores({ 'memory': freshMemory });

      // Restore state.
      const { dagName, state: resumeState, cursor } = recalled.restoreState(
        CheckpointRestoreAdapter.wrap((snap) => ArchivistState.restore(snap)),
      );

      // Supply human answer.
      resumeState.query = 'test query after reload';

      // Build a fresh dispatcher to simulate the resumed session.
      const freshDispatcher = ArchivistHitlHarness.dispatcher(new StubLlmForHitl(), freshMemory);

      // Resume and drain.
      const execution = freshDispatcher.resume(dagName, resumeState, cursor);
      for await (const _stage of execution) { /* drain */ }
      const result = await execution;

      // Assert completed lifecycle.
      assert.equal(
        result.state.lifecycle.variant,
        'completed',
        'lifecycle must be "completed" after resume',
      );

      // Assert the triple written before park survives the checkpoint round-trip.
      const found = freshMemory.ask({
        'subject':   MemoryStore.iri('urn:test:subject'),
        'predicate': MemoryStore.iri('urn:test:pred'),
      });
      assert.ok(found, 'triple written before park must be present in freshMemory after restore');

      await freshCkptStore.disconnect();
    });
  });
});
