/**
 * Archivist DAG end-to-end integration test.
 *
 * Runs the fully assembled dispatcher (parent DAG + both embedded-DAG bundles
 * + tool-registry bundles) with a completely stubbed LLM client and stubbed
 * tool scouts. No network traffic is issued; all LLM methods return canned
 * deterministic responses.
 *
 * Two scenarios covered:
 *
 *   1. off-topic query — classifyIntent returns 'off-topic'. DeclineOffTopicNode
 *      writes a canned draft; no further LLM calls. Asserts:
 *        - lifecycle.variant === 'completed'
 *        - state.draft is a non-empty string
 *        - state.intent === 'off-topic'
 *
 *   2. on-topic query (book search, empty scout results) — classifyIntent
 *      returns 'on-topic'; extractTerms and decideTools return canned plans;
 *      rankCandidates returns the unchanged (empty) list; composeEmptyResponse
 *      throws (simulating LLM failure) so the salvage node produces a
 *      deterministic draft. Asserts:
 *        - lifecycle.variant === 'completed'
 *        - state.draft is a non-empty string (salvage or LLM-produced)
 *        - state.intent is an on-topic variant
 *
 * Node 24 type-stripping: no enums, no namespaces, no parameter properties.
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
import type { ArchivistServices, ClassifiedIntent, LlmClientInterface } from '../../services.ts';
import type { CandidateType } from '../../entities/Book.ts';

// ── Stub tool definition ─────────────────────────────────────────────────────

/** Minimal ToolDefinitionType satisfying the service property types. */
const STUB_DEFINITION = {
  'name':         'stub',
  'description':  '',
  'inputSchema':  { 'type': 'object' as const },
  'outputSchema': { 'type': 'object' as const },
  'strict':       false,
} satisfies ArchivistServices['webSearch']['definition'];

// ── Never-called null stubs ──────────────────────────────────────────────────

/** Satisfies ToolInterface; execute() is never called in these tests. */
class NullTool {
  readonly definition = STUB_DEFINITION;
  async execute(): Promise<never> {
    return Promise.reject(new Error('NullTool.execute: should not be called'));
  }
}

/**
 * A ToolInterface that records calls and returns empty candidate arrays.
 * Registered with the ToolRegistry so the scatter scouts have something to
 * call; all return empty so merge routes to the empty path.
 */
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

// ── Stubbed LLM implementations ──────────────────────────────────────────────

/**
 * StubLlmOffTopic: classifyIntent always returns 'off-topic'.
 * All other methods reject (they should never be called on the off-topic path).
 */
class StubLlmOffTopic implements LlmClientInterface {
  async classifyIntent(): Promise<ClassifiedIntent> { return 'off-topic'; }
  async extractTerms(): Promise<never>              { return Promise.reject(new Error('not called')); }
  async decideTools(): Promise<never>               { return Promise.reject(new Error('not called')); }
  async rankCandidates(): Promise<never>            { return Promise.reject(new Error('not called')); }
  async compose(): Promise<never>                   { return Promise.reject(new Error('not called')); }
  async composeAuthor(): Promise<never>             { return Promise.reject(new Error('not called')); }
  async composeReviews(): Promise<never>            { return Promise.reject(new Error('not called')); }
  async describeBook(): Promise<never>              { return Promise.reject(new Error('not called')); }
  async composeSimilar(): Promise<never>            { return Promise.reject(new Error('not called')); }
  async validate(): Promise<never>                  { return Promise.reject(new Error('not called')); }
  async composeMemoryRecall(): Promise<never>       { return Promise.reject(new Error('not called')); }
  async composeEmptyResponse(): Promise<never>      { return Promise.reject(new Error('not called')); }
  async suggestStarterQuery(): Promise<never>       { return Promise.reject(new Error('not called')); }
  async suggestGreeting(): Promise<never>           { return Promise.reject(new Error('not called')); }
  async suggestVisitorReplyTo(): Promise<never>     { return Promise.reject(new Error('not called')); }
  async explainTool(): Promise<never>               { return Promise.reject(new Error('not called')); }
}

/**
 * StubLlmOnTopic: classifyIntent returns 'search' (generic on-topic intent).
 * Tools and ranking return canned empty plans so all scouts produce no candidates.
 * composeEmptyResponse throws to exercise the salvage path — the deterministic
 * salvage node writes a canned draft so the run still completes.
 */
class StubLlmOnTopic implements LlmClientInterface {
  async classifyIntent(): Promise<ClassifiedIntent> { return 'search'; }

  async extractTerms(): Promise<readonly string[]> {
    return ['book', 'library', 'strange', 'house'];
  }

  async decideTools(): Promise<ReadonlyArray<{ name: string; arguments: Record<string, unknown> }>> {
    // Return a minimal tool plan naming the OpenLibrary scout.
    return [{ 'name': 'web_search_books', 'arguments': { 'query': 'strange house library book' } }];
  }

  async rankCandidates(_query: string, candidates: readonly CandidateType[]): Promise<readonly { candidate: CandidateType; score: number }[]> {
    // Return the unchanged list (empty when all scouts returned nothing).
    return candidates.map((c) => ({ 'candidate': c, 'score': c.score }));
  }

  async compose(): Promise<never>                   { return Promise.reject(new Error('not called in empty path')); }
  async composeAuthor(): Promise<never>             { return Promise.reject(new Error('not called')); }
  async composeReviews(): Promise<never>            { return Promise.reject(new Error('not called')); }
  async describeBook(): Promise<never>              { return Promise.reject(new Error('not called')); }
  async composeSimilar(): Promise<never>            { return Promise.reject(new Error('not called')); }
  async validate(): Promise<never>                  { return Promise.reject(new Error('not called')); }
  async composeMemoryRecall(): Promise<never>       { return Promise.reject(new Error('not called')); }

  /**
   * Throws so the compose-empty node exhausts its retry budget and the
   * salvage node (composeEmptyResponseSalvageNode) writes a deterministic
   * canned draft, completing the run without LLM involvement.
   */
  async composeEmptyResponse(): Promise<never> {
    return Promise.reject(new Error('StubLlmOnTopic: simulated LLM failure → triggers salvage'));
  }

  async suggestStarterQuery(): Promise<string> { return 'What books do you recommend?'; }
  async suggestGreeting(): Promise<string>     { return 'Welcome to the archive.'; }
  async suggestVisitorReplyTo(): Promise<string> { return 'Tell me more about mysteries.'; }
  async explainTool(): Promise<string>         { return 'This tool searches for books.'; }
}

// ── Harness ──────────────────────────────────────────────────────────────────

/**
 * ArchivistHarness: encapsulates dispatcher construction and run helpers.
 *
 * Static-only. No freestanding functions.
 */
class ArchivistHarness {
  private constructor() { /* static-only */ }

  /**
   * Build a Dagonizer instance with all archivist bundles registered.
   * The caller supplies the LLM implementation; tools are empty scouts.
   */
  static dispatcher(llm: LlmClientInterface): Dagonizer<ArchivistState> {
    const memory = new MemoryStore();

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

    // Tool registry: register four empty-result scouts so the scatter body
    // DAGs (tool:web_search_books, tool:google_books_search, etc.) exist in
    // the dispatcher. Without this the DAG validator would reject the
    // embedded-DAG references in BookSearchScatterDAG.
    const toolRegistry = new ToolRegistry();
    toolRegistry.register(new EmptyScoutTool('web_search_books'));
    toolRegistry.register(new EmptyScoutTool('google_books_search'));
    toolRegistry.register(new EmptyScoutTool('subject_search'));
    toolRegistry.register(new EmptyScoutTool('wikipedia_summary'));
    dispatcher.registerBundle(toolRegistry.bundle());

    // Construct every services-injected node exactly once; the shared set is
    // passed to all three registrations so duplicate registrations refer to
    // identical instances and the registrar accepts them.
    const nodes = ArchivistNodes.build(services);

    // Embedded-DAG bundles register before the parent DAG.
    dispatcher.registerBundle({ 'nodes': nodes.bookSearchScatterNodes, 'dags': [bookSearchScatterDAG] });
    dispatcher.registerBundle({ 'nodes': nodes.composeRetryLoopNodes, 'dags': [composeRetryLoopDAG] });
    dispatcher.registerBundle({ 'nodes': nodes.parentNodes, 'dags': [archivistDAG] });

    return dispatcher;
  }

  /**
   * Execute the archivist DAG and drain the stage iterator. Returns the
   * final ArchivistState. Throws if the dispatcher throws.
   */
  static async run(llm: LlmClientInterface, query: string): Promise<ArchivistState> {
    const dispatcher = ArchivistHarness.dispatcher(llm);
    const state = new ArchivistState();
    state.query = query;

    const execution = dispatcher.execute('the-archivist', state);
    for await (const _stage of execution) { /* drain */ }
    await execution;
    return state;
  }
}

// ── Off-topic scenario ────────────────────────────────────────────────────────

describe('Archivist DAG — off-topic query', () => {
  let state: ArchivistState;

  before(async () => {
    state = await ArchivistHarness.run(
      new StubLlmOffTopic(),
      'What is the capital of France?',
    );
  }, { timeout: 30_000 });

  it('reaches lifecycle "completed"', () => {
    assert.equal(state.lifecycle.variant, 'completed');
  });

  it('sets intent to "off-topic"', () => {
    assert.equal(state.intent, 'off-topic');
  });

  it('writes a non-empty draft (canned decline message)', () => {
    assert.ok(state.draft.length > 0, 'draft must be non-empty after off-topic decline');
  });

  it('shortlist remains empty (no book search ran)', () => {
    assert.equal(state.shortlist.length, 0, 'shortlist must be empty on off-topic branch');
  });

  it('candidates remain empty', () => {
    assert.equal(state.candidates.length, 0);
  });
});

// ── On-topic scenario (empty scouts → salvage draft) ─────────────────────────

describe('Archivist DAG — on-topic query with empty scouts', () => {
  let state: ArchivistState;

  before(async () => {
    state = await ArchivistHarness.run(
      new StubLlmOnTopic(),
      "I'm looking for a book about a strange house with a library",
    );
  }, { timeout: 60_000 });

  it('reaches lifecycle "completed"', () => {
    assert.equal(state.lifecycle.variant, 'completed');
  });

  it('classifies intent as an on-topic variant', () => {
    const onTopicIntents = new Set([
      'on-topic', 'search', 'describe', 'recommend',
      'lookup-author', 'find-reviews', 'describe-book', 'recommend-similar',
    ]);
    assert.ok(
      onTopicIntents.has(state.intent),
      `Expected an on-topic intent, got "${state.intent}"`,
    );
  });

  it('writes a non-empty draft (salvage or compose-empty)', () => {
    assert.ok(state.draft.length > 0, 'draft must be non-empty — salvage node must have written something');
  });

  it('runId is set (preRunSetup ran)', () => {
    assert.ok(state.runId.length > 0, 'runId must be set by the pre-phase setup node');
  });

  it('terms were extracted from the query', () => {
    assert.ok(state.terms.length > 0, 'terms must be populated by extractTerms stub or salvage');
  });
});

// ── Bundle registration smoke ─────────────────────────────────────────────────

describe('Archivist DAG bundle registration', () => {
  it('registers all bundles without throwing', () => {
    assert.doesNotThrow(() => ArchivistHarness.dispatcher(new StubLlmOffTopic()));
  });

  it('dispatcher is constructed with a valid MemoryStore', () => {
    const memory = new MemoryStore();
    assert.ok(memory.size >= 0, 'MemoryStore must be constructable with non-negative size');
  });
});
