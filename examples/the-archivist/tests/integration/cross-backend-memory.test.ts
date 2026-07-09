/**
 * Cross-backend persistent memory integration test.
 *
 * Proves that two Archivist conversation turns running against TWO DIFFERENT
 * LLM backend stubs can share ONE MemoryStore and that turn 2 (a different
 * class/identity LLM stub) recalls what turn 1 found and recorded.
 *
 * Contract under test:
 *   - Turn 1 (BackendA stub): classifies on-topic, scout returns a non-empty
 *     candidate, the run reaches `record-findings`, which writes the shortlisted
 *     book (isbn "0000000001") into GRAPH_MEMORY via `dag:shortlisted`.
 *     `StateProjection.project` is called explicitly after the run to write
 *     the per-run state graph into the shared MemoryStore.
 *
 *   - Turn 2 (BackendB stub — different class): runs on the SAME shared
 *     MemoryStore. The `recall-context` node SPARQLs the state graphs, finds
 *     turn 1's query, computes Jaccard > 0, and surfaces turn 1's shortlisted
 *     book in `state.recalledContext.recentCandidates`.
 *
 * Assertions (acceptance criteria):
 *   - `state2.recalledContext.recentCandidates` includes the book isbn "0000000001"
 *     that turn 1 recorded — i.e. a different model recalls the prior finding.
 *   - `state2.recalledContext.priorIntents` references turn 1's query text.
 *   - Both turns reach lifecycle.variant === 'completed'.
 *
 * Node 24 type-stripping: no enums, no namespaces, no parameter properties.
 * Dagonizer CLAUDE.md: noun.verb() only, no freestanding functions, no `as` casts.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import { Dagonizer } from '@studnicky/dagonizer';
import { ToolRegistry } from '@studnicky/dagonizer/tool';
import { ArchivistState } from '../../ArchivistState.ts';
import { ArchivistNodes } from '../../nodes/ArchivistNodes.ts';
import { archivistDAG } from '../../dag.ts';
import { bookSearchScatterDAG } from '../../embedded-dags/BookSearchScatterDAG.ts';
import { composeRetryLoopDAG } from '../../embedded-dags/ComposeRetryLoopDAG.ts';
import { MemoryStore } from '../../memory/MemoryStore.ts';
import { StateProjection } from '../../state/StateProjection.ts';
import { BookBuilder } from '../../entities/Book.ts';
import type { ArchivistServices, ClassifiedIntent, LlmClientInterface } from '../../services.ts';
import type { CandidateType } from '../../entities/Book.ts';

// ── Shared fixture book ──────────────────────────────────────────────────────

/** ISBN written by turn 1, asserted visible in turn 2's recalled context. */
const FIXTURE_ISBN  = '0000000001';
const FIXTURE_TITLE = 'The House of Memory';
const FIXTURE_QUERY = 'book about a strange house with a mysterious library';

const FIXTURE_CANDIDATE: CandidateType = {
  'book':   BookBuilder.from({
    'isbn':    FIXTURE_ISBN,
    'title':   FIXTURE_TITLE,
    'authors': ['I.M. Testauthor'],
    'price':   { 'amount': 0, 'currency': 'USD' },
  }),
  'score':  0.85,
  'source': 'web_search_books',
};

// ── Stub tool definitions ────────────────────────────────────────────────────

const STUB_DEF = {
  'name':         'stub',
  'description':  '',
  'inputSchema':  { 'type': 'object' as const },
  'outputSchema': { 'type': 'object' as const },
  'strict':       false,
} satisfies ArchivistServices['webSearch']['definition'];

/** Satisfies ToolInterface; execute() is never called in these tests. */
class NullTool {
  readonly definition = STUB_DEF;
  async execute(): Promise<never> {
    return Promise.reject(new Error('NullTool.execute: should not be called'));
  }
}

/**
 * FilledScoutTool: named scout that returns the fixture candidate.
 * Registered as 'web_search_books' so the scatter fires it for the
 * LLM-planned tool call. Turn 1's ShortlistingLlmBackendA decides
 * tool 'web_search_books' and this returns FIXTURE_CANDIDATE.
 */
class FilledScoutTool {
  readonly definition: typeof STUB_DEF & { name: string };

  constructor(toolName: string) {
    this.definition = {
      'name':         toolName,
      'description':  `${toolName} stub — returns fixture candidate`,
      'inputSchema':  { 'type': 'object' as const },
      'outputSchema': { 'type': 'object' as const },
      'strict':       false,
    };
  }

  async execute(): Promise<readonly CandidateType[]> {
    return [FIXTURE_CANDIDATE];
  }
}

/** Returns empty candidates; used for scouts that BackendA doesn't plan. */
class EmptyScoutTool {
  readonly definition: typeof STUB_DEF & { name: string };

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

// ── LLM stub: BackendA (turn 1) ──────────────────────────────────────────────

/**
 * ShortlistingLlmBackendA: models the FIRST LLM backend.
 *
 * - Classifies query as 'search'.
 * - Extracts meaningful terms (overlap with FIXTURE_TITLE for Jaccard).
 * - Plans 'web_search_books' so FilledScoutTool fires.
 * - rankCandidates: not called (only one candidate → no tiebreak).
 * - compose: returns a canned draft string.
 * - validate: returns true (approved) so the run terminates cleanly.
 *   This ensures `record-findings` actually executes before the run ends.
 */
class ShortlistingLlmBackendA implements LlmClientInterface {
  async classifyIntent(): Promise<ClassifiedIntent> { return 'search'; }

  async extractTerms(): Promise<readonly string[]> {
    return ['strange', 'house', 'library', 'memory'];
  }

  async decideTools(): Promise<ReadonlyArray<{ name: string; arguments: Record<string, unknown> }>> {
    return [{ 'name': 'web_search_books', 'arguments': { 'query': FIXTURE_QUERY } }];
  }

  async rankCandidates(
    _query: string,
    candidates: readonly CandidateType[],
  ): Promise<readonly { candidate: CandidateType; score: number }[]> {
    return candidates.map((c) => ({ 'candidate': c, 'score': c.score }));
  }

  async compose(): Promise<string> {
    return `The Archivist (BackendA) recommends "${FIXTURE_TITLE}".`;
  }

  async composeAuthor(): Promise<string>   { return 'BackendA author draft.'; }
  async composeReviews(): Promise<string>  { return 'BackendA reviews draft.'; }
  async describeBook(): Promise<string>    { return 'BackendA describe draft.'; }
  async composeSimilar(): Promise<string>  { return 'BackendA similar draft.'; }

  async validate(): Promise<boolean> { return true; }

  async composeMemoryRecall(): Promise<string>  { return 'BackendA memory draft.'; }
  async composeEmptyResponse(): Promise<string> { return 'BackendA empty draft.'; }
  async suggestStarterQuery(): Promise<string>  { return 'What books do you have?'; }
  async suggestGreeting(): Promise<string>      { return 'Welcome, visitor.'; }
  async suggestVisitorReplyTo(): Promise<string> { return 'Tell me about mysteries.'; }
  async explainTool(): Promise<string>          { return 'This searches for books.'; }
}

// ── LLM stub: BackendB (turn 2) ──────────────────────────────────────────────

/**
 * RecallingLlmBackendB: models the SECOND, DIFFERENT LLM backend.
 *
 * Different class from ShortlistingLlmBackendA; models a provider swap.
 * In the cross-backend test, turn 2 only runs recall-context (and the
 * pre-phase setup) in isolation to exercise the recall read path without
 * requiring a full successful scout run. The full-DAG turn 2 path would
 * need scouts to return candidates too; to keep the test deterministic we
 * use the recovery path: run the full DAG with empty scouts so it reaches
 * compose-empty/salvage, but we capture `state2.recalledContext` which is
 * populated by recall-context BEFORE classification.
 */
class RecallingLlmBackendB implements LlmClientInterface {
  async classifyIntent(): Promise<ClassifiedIntent> { return 'search'; }

  async extractTerms(): Promise<readonly string[]> {
    return ['strange', 'house', 'library'];
  }

  async decideTools(): Promise<ReadonlyArray<{ name: string; arguments: Record<string, unknown> }>> {
    return [{ 'name': 'web_search_books', 'arguments': { 'query': FIXTURE_QUERY } }];
  }

  async rankCandidates(
    _query: string,
    candidates: readonly CandidateType[],
  ): Promise<readonly { candidate: CandidateType; score: number }[]> {
    return candidates.map((c) => ({ 'candidate': c, 'score': c.score }));
  }

  async compose(): Promise<never>                    { return Promise.reject(new Error('BackendB: not on compose path')); }
  async composeAuthor(): Promise<never>              { return Promise.reject(new Error('not called')); }
  async composeReviews(): Promise<never>             { return Promise.reject(new Error('not called')); }
  async describeBook(): Promise<never>               { return Promise.reject(new Error('not called')); }
  async composeSimilar(): Promise<never>             { return Promise.reject(new Error('not called')); }
  async validate(): Promise<never>                   { return Promise.reject(new Error('not called')); }
  async composeMemoryRecall(): Promise<never>        { return Promise.reject(new Error('not called')); }

  /**
   * BackendB: composeEmptyResponse returns a canned draft so the run
   * terminates cleanly via salvage. The recall assertion fires on
   * state.recalledContext which is populated before classification.
   */
  async composeEmptyResponse(): Promise<string> {
    return 'BackendB (empty): no live results this turn.';
  }

  async suggestStarterQuery(): Promise<string>  { return 'Any recommendations?'; }
  async suggestGreeting(): Promise<string>      { return 'Hello from BackendB.'; }
  async suggestVisitorReplyTo(): Promise<string> { return 'Sounds interesting.'; }
  async explainTool(): Promise<string>           { return 'A book search tool.'; }
}

// ── Harness ──────────────────────────────────────────────────────────────────

/**
 * CrossBackendHarness: encapsulates dispatcher construction for the
 * cross-backend memory continuity test.
 *
 * Static-only. No freestanding functions.
 */
class CrossBackendHarness {
  private constructor() { /* static-only */ }

  /**
   * Build a Dagonizer with all archivist bundles registered, wired to
   * the supplied services. The caller owns the MemoryStore so it can be
   * shared across turns.
   */
  static dispatcher(services: ArchivistServices): Dagonizer<ArchivistState> {
    const dispatcher = new Dagonizer<ArchivistState>();

    // Tool registry: register one filled scout for web_search_books and
    // empty stubs for the remaining three, so all DAG references resolve.
    const toolRegistry = new ToolRegistry();
    toolRegistry.register(services.webSearch);
    toolRegistry.register(new EmptyScoutTool('google_books_search'));
    toolRegistry.register(new EmptyScoutTool('subject_search'));
    toolRegistry.register(new EmptyScoutTool('wikipedia_summary'));
    dispatcher.registerBundle(toolRegistry.bundle());

    const nodes = ArchivistNodes.build(services);
    dispatcher.registerBundle({ 'nodes': nodes.bookSearchScatterNodes, 'dags': [bookSearchScatterDAG] });
    dispatcher.registerBundle({ 'nodes': nodes.composeRetryLoopNodes, 'dags': [composeRetryLoopDAG] });
    dispatcher.registerBundle({ 'nodes': nodes.parentNodes, 'dags': [archivistDAG] });

    return dispatcher;
  }

  /**
   * Build the ArchivistServices record for a given LLM stub and shared MemoryStore.
   * The webSearch tool is the FilledScoutTool for BackendA (to produce candidates)
   * and an EmptyScoutTool for BackendB (so recall is the only signal).
   */
  static services(
    llm: LlmClientInterface,
    memory: MemoryStore,
    fillWebSearch: boolean,
  ): ArchivistServices {
    return {
      'webSearch':        fillWebSearch ? new FilledScoutTool('web_search_books') : new EmptyScoutTool('web_search_books'),
      'googleBooks':      new NullTool(),
      'wikipediaSummary': new NullTool(),
      'subjectSearch':    new NullTool(),
      'llm':              llm,
      'memory':           memory,
      'embedder':         null,
      'nodeTimeouts':     {},
    };
  }

  /**
   * Execute the archivist DAG and drain the stage iterator. Returns the
   * final ArchivistState. Throws if the dispatcher throws.
   */
  static async run(
    llm: LlmClientInterface,
    memory: MemoryStore,
    query: string,
    fillWebSearch: boolean,
  ): Promise<ArchivistState> {
    const services   = CrossBackendHarness.services(llm, memory, fillWebSearch);
    const dispatcher = CrossBackendHarness.dispatcher(services);
    const state      = new ArchivistState();
    state.query      = query;

    const execution = dispatcher.execute('urn:noocodec:dag:the-archivist', state);
    for await (const _stage of execution) { /* drain */ }
    await execution;
    return state;
  }
}

// ── Cross-backend memory continuity scenario ──────────────────────────────────

describe('Archivist DAG — cross-backend persistent memory', () => {
  let state1: ArchivistState;
  let state2: ArchivistState;

  /** Shared memory store: the single graph persisted between the two turns. */
  const sharedMemory = new MemoryStore();

  before(async () => {
    // ── Turn 1: BackendA finds and records a book ─────────────────────────
    // Run the full DAG with BackendA (filled scout → shortlist → record-findings).
    state1 = await CrossBackendHarness.run(
      new ShortlistingLlmBackendA(),
      sharedMemory,
      FIXTURE_QUERY,
      true,  // fillWebSearch = true → FilledScoutTool returns FIXTURE_CANDIDATE
    );

    // Explicitly project turn 1's state into the shared MemoryStore so that
    // recall-context in turn 2 can SPARQL the per-run state graph for prior
    // intents and recent candidates.
    // StateProjection.project is normally called from a custom ObservedDag
    // subclass's onNodeEnd hook; in test harnesses it is called once after
    // the run completes, which satisfies the cross-run recall contract.
    StateProjection.project(state1, sharedMemory);

    // ── Turn 2: BackendB (different class/identity) starts on same store ──
    // Scouts are empty so live results are zero. recall-context runs first
    // and reads what BackendA recorded into the shared MemoryStore.
    // The run reaches salvage/compose-empty and terminates cleanly.
    state2 = await CrossBackendHarness.run(
      new RecallingLlmBackendB(),
      sharedMemory,
      FIXTURE_QUERY,  // same query text → Jaccard = 1.0 vs turn 1
      false, // fillWebSearch = false → no live candidates in turn 2
    );
  }, { timeout: 60_000 });

  // ── Turn 1 baseline assertions ────────────────────────────────────────────

  it('turn 1: reaches lifecycle "completed"', () => {
    assert.equal(state1.lifecycle.variant, 'completed');
  });

  it('turn 1: classifies as on-topic intent', () => {
    const onTopicIntents = new Set([
      'on-topic', 'search', 'describe', 'recommend',
      'lookup-author', 'find-reviews', 'describe-book', 'recommend-similar',
    ]);
    assert.ok(
      onTopicIntents.has(state1.intent),
      `Expected on-topic intent, got "${state1.intent}"`,
    );
  });

  it('turn 1: shortlist includes the fixture book', () => {
    const found = state1.shortlist.some((c) => c.book.identity.isbn === FIXTURE_ISBN);
    assert.ok(found, `Shortlist must contain isbn ${FIXTURE_ISBN}; shortlist = ${JSON.stringify(state1.shortlist.map((c) => c.book.identity.isbn))}`);
  });

  it('turn 1: produces a non-empty draft (compose ran)', () => {
    assert.ok(state1.draft.length > 0, 'draft must be non-empty after BackendA composed');
  });

  it('turn 1: memory store grew (record-findings wrote triples)', () => {
    assert.ok(sharedMemory.size > 0, 'MemoryStore must be non-empty after turn 1');
  });

  // ── Turn 2 baseline assertions ────────────────────────────────────────────

  it('turn 2: reaches lifecycle "completed"', () => {
    assert.equal(state2.lifecycle.variant, 'completed');
  });

  // ── Cross-backend continuity assertions ───────────────────────────────────
  //
  // These are the KEY assertions proving that BackendB (a different LLM
  // stub class) read what BackendA recorded via the shared MemoryStore.

  it('turn 2: recalledContext.recentCandidates contains the book BackendA shortlisted', () => {
    const recalled = state2.recalledContext.recentCandidates;
    const found = recalled.some((c) => c.book.identity.isbn === FIXTURE_ISBN);
    assert.ok(
      found,
      `BackendB must recall isbn ${FIXTURE_ISBN} from the shared MemoryStore. ` +
      `recentCandidates = [${recalled.map((c) => c.book.identity.isbn).join(', ')}]`,
    );
  });

  it('turn 2: recalledContext.priorIntents references turn 1 query', () => {
    const priorIntents = state2.recalledContext.priorIntents;
    const found = priorIntents.some((p) => p.query === FIXTURE_QUERY);
    assert.ok(
      found,
      `BackendB must surface turn 1 query in priorIntents. ` +
      `priorIntents = ${JSON.stringify(priorIntents)}`,
    );
  });

  it('turn 2: recalledContext.summary is non-empty (memory was recalled)', () => {
    assert.ok(
      state2.recalledContext.summary.length > 0,
      `recalledContext.summary must be non-empty when prior intents / candidates exist`,
    );
  });

  it('turn 2: recalledContext title matches the fixture title', () => {
    const recalled = state2.recalledContext.recentCandidates;
    const match = recalled.find((c) => c.book.identity.isbn === FIXTURE_ISBN);
    assert.ok(match !== undefined, 'fixture candidate must be in recentCandidates');
    assert.equal(
      match.book.identity.title,
      FIXTURE_TITLE,
      `Recalled title must match fixture. Got "${match.book.identity.title}"`,
    );
  });
});
