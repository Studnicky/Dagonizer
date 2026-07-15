/**
 * ArchivistSession headless integration tests.
 *
 * Exercises `ArchivistSession` via a concrete `HeadlessArchivistSession`
 * subclass that collects every seam call into typed arrays for assertion.
 * No real LLM or HTTP calls are made:
 *   - `HeadlessStubLlm` returns deterministic responses for `suggestGreeting`,
 *     `classifyIntent`, etc.
 *   - `HeadlessArchivistSession.buildRig` injects stub scouts (empty results)
 *     exactly as `ArchivistHarness.dispatcher` does in the existing e2e test.
 *   - `HeadlessArchivistSession.provisionEmbedder` short-circuits to null
 *     (no CDN imports, no WebGPU probes).
 *
 * Regression guard: the `sampleReply` must differ from the greeting, must come
 * from the manual visitor seed pool, and must not match static greeting prefix
 * patterns (`/^welcome|^come in|^stay a while/i`).
 *
 * Node 24 type-stripping: no enums, no namespaces, no parameter properties.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import { ToolRegistry } from '@studnicky/dagonizer/tool';
import { Clock, VirtualClockProvider, VirtualTimeCounter } from '@studnicky/clock';

import { ArchivistSession, STATIC_VISITOR_REPLIES } from '../../ArchivistSession.ts';
import type {
  SessionDagEvent,
  SessionNodeEvent,
  SessionRig,
} from '../../ArchivistSession.ts';
import type { ConversationTurn } from '../../ArchivistState.ts';
import type { BackendAvailability } from '../../providers/index.ts';
import type { EmbedderProvisionResultType } from '../../providers/index.ts';
import { MemoryStore } from '../../memory/MemoryStore.ts';
import { ConsoleLogger } from '../../logger/ConsoleLogger.ts';
import type { ArchivistServices, ClassifiedIntent, LlmClientInterface } from '../../services.ts';
import type { CandidateType } from '../../entities/Book.ts';

const ARCHIVIST_DAG_IRI = 'urn:noocodec:dag:the-archivist';

// ── Stub tool definition ─────────────────────────────────────────────────────

const STUB_DEF = {
  'name':         'stub',
  'description':  '',
  'inputSchema':  { 'type': 'object' as const },
  'outputSchema': { 'type': 'object' as const },
  'strict':       false,
} satisfies ArchivistServices['webSearch']['definition'];

class EmptyScout {
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

  async execute(): Promise<readonly CandidateType[]> { return []; }
}

class NullTool {
  readonly definition = STUB_DEF;
  async execute(): Promise<never> { return Promise.reject(new Error('NullTool.execute: should not be called')); }
}

// ── Stub LLM ─────────────────────────────────────────────────────────────────

/**
 * HeadlessStubLlm: deterministic LlmClientInterface for session tests.
 *
 * `suggestGreeting` returns a quoted string so the session sanitizer strips
 * wrapper quotes before rendering or recording. Every other method that IS
 * called on the run path (classifyIntent, extractTerms, decideTools,
 * composeEmptyResponse) returns values that drive the salvage path without
 * making network calls. Methods that should NOT be called on the off-topic /
 * empty-scout path reject to surface accidental invocations.
 */
class HeadlessStubLlm implements LlmClientInterface {
  static readonly GREETING = 'Good evening, bookseeker. What tale draws you tonight?';
  static readonly RAW_GREETING = `"${HeadlessStubLlm.GREETING}"`;
  static readonly VISITOR_REPLY = 'I am looking for something about a haunted archive.';
  static readonly RAW_VISITOR_REPLY = `"${HeadlessStubLlm.VISITOR_REPLY}"`;

  async suggestGreeting(): Promise<string> {
    return HeadlessStubLlm.RAW_GREETING;
  }

  async suggestVisitorReplyTo(_greeting: string): Promise<string> {
    // Must differ from the greeting and from static greeting pool prefixes.
    return HeadlessStubLlm.RAW_VISITOR_REPLY;
  }

  async classifyIntent(): Promise<ClassifiedIntent> { return 'search'; }

  async extractTerms(): Promise<readonly string[]> {
    return ['haunted', 'archive', 'books'];
  }

  async decideTools(): Promise<ReadonlyArray<{ name: string; arguments: Record<string, unknown> }>> {
    return [{ 'name': 'web_search_books', 'arguments': { 'query': 'haunted archive' } }];
  }

  async rankCandidates(
    _query: string,
    candidates: readonly CandidateType[],
  ): Promise<readonly { candidate: CandidateType; score: number }[]> {
    return candidates.map((c) => ({ 'candidate': c, 'score': c.score }));
  }

  async compose(): Promise<never>                  { return Promise.reject(new Error('not reached on empty path')); }
  async composeAuthor(): Promise<never>            { return Promise.reject(new Error('not called')); }
  async composeReviews(): Promise<never>           { return Promise.reject(new Error('not called')); }
  async describeBook(): Promise<never>             { return Promise.reject(new Error('not called')); }
  async composeSimilar(): Promise<never>           { return Promise.reject(new Error('not called')); }
  async validate(): Promise<never>                 { return Promise.reject(new Error('not called')); }
  async composeMemoryRecall(): Promise<never>      { return Promise.reject(new Error('not called')); }

  // Throws → salvage node writes a deterministic canned draft; run still completes.
  async composeEmptyResponse(): Promise<never> {
    return Promise.reject(new Error('HeadlessStubLlm: simulated failure → triggers salvage'));
  }

  async suggestStarterQuery(): Promise<string>  { return 'What books do you recommend?'; }
  async explainTool(): Promise<string>          { return 'This tool searches for books.'; }
}

// ── HeadlessArchivistSession ─────────────────────────────────────────────────

/**
 * Concrete subclass that collects every seam call into typed arrays.
 *
 * Extension seams overridden here:
 *   `buildRig`         → stub scouts (no HTTP)
 *   `provisionEmbedder` → null (no CDN / WebGPU)
 *   `onReset`          → records call for assertion
 *   `on*`              → push into typed collection arrays
 */
class HeadlessArchivistSession extends ArchivistSession {
  readonly greetingsReceived:   string[]                          = [];
  readonly sampleReplies:       string[]                          = [];
  readonly visitorTurns:        string[]                          = [];
  readonly archivistTurns:      string[]                          = [];
  readonly nodeEvents:          SessionNodeEvent[]                = [];
  readonly dagEvents:           SessionDagEvent[]                 = [];
  readonly runEnds:             Extract<SessionDagEvent, { kind: 'flowEnd' }>[] = [];
  readonly errors:              Error[]                           = [];
  readonly backendsReadyCalls:  Array<{ noModel: boolean }>       = [];
  memoryChangedCount = 0;
  resetCount = 0;

  protected override buildRig(
    llm: LlmClientInterface,
    embedder: import('@studnicky/dagonizer/contracts').EmbedderInterface | null,
  ): SessionRig {
    const toolRegistry = new ToolRegistry();
    toolRegistry.register(new EmptyScout('web_search_books'));
    toolRegistry.register(new EmptyScout('google_books_search'));
    toolRegistry.register(new EmptyScout('subject_search'));
    toolRegistry.register(new EmptyScout('wikipedia_summary'));

    const services: ArchivistServices = {
      'webSearch':        new NullTool(),
      'googleBooks':      new NullTool(),
      'subjectSearch':    new NullTool(),
      'wikipediaSummary': new NullTool(),
      'llm':              llm,
      'memory':           this.store,
      'embedder':         embedder,
      'nodeTimeouts':     {},
    };

    return { services, toolRegistry };
  }

  protected override async provisionEmbedder(): Promise<EmbedderProvisionResultType> {
    return { 'embedder': null, 'intentClassifier': null };
  }

  protected override onReset(): void { this.resetCount++; }

  protected override onBackendsReady(
    _backends: readonly BackendAvailability[],
    noModel: boolean,
  ): void {
    this.backendsReadyCalls.push({ noModel });
  }

  protected override onGreetingReady(greeting: string): void {
    this.greetingsReceived.push(greeting);
  }

  protected override onSampleReplyReady(reply: string): void {
    this.sampleReplies.push(reply);
  }

  protected override onVisitorTurn(query: string): void {
    this.visitorTurns.push(query);
  }

  protected override onArchivistTurn(draft: string): void {
    this.archivistTurns.push(draft);
  }

  protected override onNodeEvent(event: SessionNodeEvent): void {
    this.nodeEvents.push(event);
  }

  protected override onDagEvent(event: SessionDagEvent): void {
    this.dagEvents.push(event);
  }

  protected override onRunEnd(event: Extract<SessionDagEvent, { kind: 'flowEnd' }>): void {
    this.runEnds.push(event);
  }

  protected override onMemoryChanged(): void {
    this.memoryChangedCount++;
  }

  protected override onError(error: Error): void {
    this.errors.push(error);
  }

  memoryConversation(limit: number): readonly ConversationTurn[] {
    return this.store.conversationTurns(limit);
  }
}

// ── Factory helpers ──────────────────────────────────────────────────────────

class SessionHarness {
  private constructor() { /* static-only */ }

  static make(): HeadlessArchivistSession {
    const store  = new MemoryStore();
    const logger = new ConsoleLogger();
    return new HeadlessArchivistSession(store, logger, { 'llm': new HeadlessStubLlm() });
  }
}

// ── greet() tests ────────────────────────────────────────────────────────────

describe('ArchivistSession.greet()', () => {
  let session: HeadlessArchivistSession;
  let greeting: string;

  before(async () => {
    session  = SessionHarness.make();
    greeting = await session.greet();
  }, { timeout: 15_000 });

  it('fires onGreetingReady once', () => {
    assert.equal(session.greetingsReceived.length, 1);
  });

  it('returns non-empty greeting text', () => {
    assert.ok(greeting.length > 0, 'greeting must be non-empty');
  });

  it('onGreetingReady receives the same text greet() returns', () => {
    assert.equal(session.greetingsReceived[0], greeting);
  });

  it('uses LLM-generated greeting (not static sample)', () => {
    assert.equal(greeting, HeadlessStubLlm.GREETING);
  });

  it('records the greeting in the RDF conversation graph', () => {
    assert.deepEqual(session.memoryConversation(10), [
      { 'role': 'archivist', 'text': HeadlessStubLlm.GREETING, 'ts': session.conversation[0]?.ts ?? 0 },
    ]);
  });
});

// ── sampleReply() tests ──────────────────────────────────────────────────────

describe('ArchivistSession.sampleReply()', () => {
  let session: HeadlessArchivistSession;
  let greeting: string;

  before(async () => {
    session  = SessionHarness.make();
    greeting = await session.greet();
    await session.sampleReply(greeting);
  }, { timeout: 15_000 });

  it('fires onSampleReplyReady once', () => {
    assert.equal(session.sampleReplies.length, 1);
  });

  it('sample reply is non-empty', () => {
    const reply = session.sampleReplies[0];
    assert.ok(typeof reply === 'string' && reply.length > 0, 'reply must be non-empty');
  });

  it('sample reply differs from the greeting (regression: sample ≠ greeting)', () => {
    const reply = session.sampleReplies[0] ?? '';
    assert.notEqual(reply, greeting, 'sampleReply must differ from the greeting text');
  });

  it('sample reply does not match static greeting prefix patterns', () => {
    const reply = session.sampleReplies[0] ?? '';
    assert.ok(
      !/^welcome|^come in|^stay a while/i.test(reply),
      `sample reply should not start with a greeting prefix; got: "${reply}"`,
    );
  });

  it('sample reply uses a manually seeded visitor phrase', () => {
    assert.ok(STATIC_VISITOR_REPLIES.includes(session.sampleReplies[0] ?? ''));
  });

  it('records greeting and initial visitor reply in conversation history', () => {
    const roles = session.conversation.map((t) => t.role);
    assert.deepEqual(roles, ['archivist', 'visitor']);
    assert.deepEqual(session.memoryConversation(10).map((t) => t.role), ['archivist', 'visitor']);
  });
});

// ── recorded-seed execution tests ───────────────────────────────────────────

describe('ArchivistSession.answerRecordedVisitorTurn()', () => {
  let session: HeadlessArchivistSession;
  let seedQuery: string;

  before(async () => {
    session = SessionHarness.make();
    const greeting = await session.greet();
    seedQuery = await session.sampleReply(greeting);
    await session.answerRecordedVisitorTurn(seedQuery);
  }, { timeout: 60_000 });

  it('does not duplicate the already-recorded visitor seed', () => {
    const visitorTurns = session.conversation.filter((turn) => turn.role === 'visitor');
    assert.equal(visitorTurns.length, 1);
    assert.equal(visitorTurns[0]?.text, seedQuery);
    assert.deepEqual(session.memoryConversation(10).filter((turn) => turn.role === 'visitor').map((turn) => turn.text), [seedQuery]);
  });

  it('does not fire onVisitorTurn for the already-rendered seed', () => {
    assert.deepEqual(session.visitorTurns, []);
  });

  it('executes the DAG and completes the run', () => {
    assert.equal(session.runEnds.length, 1);
    assert.equal(session.runEnds[0]?.lifecycle, 'completed');
    assert.ok(session.nodeEvents.length > 0, 'seed execution must emit node events');
  });

  it('records the Archivist answer after the seed prompt', () => {
    assert.deepEqual(session.conversation.map((turn) => turn.role), ['archivist', 'visitor', 'archivist']);
    assert.deepEqual(session.memoryConversation(10).map((turn) => turn.role), ['archivist', 'visitor', 'archivist']);
    assert.ok((session.archivistTurns[0]?.length ?? 0) > 0, 'seed prompt must produce an Archivist turn');
  });
});

// ── ask() tests ──────────────────────────────────────────────────────────────

describe('ArchivistSession.ask()', () => {
  let session: HeadlessArchivistSession;

  before(async () => {
    session = SessionHarness.make();
    await session.ask('Tell me about books with haunted archives');
  }, { timeout: 60_000 });

  it('fires onVisitorTurn before the run', () => {
    assert.ok(session.visitorTurns.length >= 1, 'onVisitorTurn must fire');
    assert.equal(session.visitorTurns[0], 'Tell me about books with haunted archives');
  });

  it('fires onNodeEvent events during execution', () => {
    assert.ok(session.nodeEvents.length > 0, 'at least one node event must fire');
  });

  it('fires onDagEvent for flowStart and flowEnd', () => {
    const kinds = session.dagEvents.map((e) => e.kind);
    assert.ok(kinds.includes('flowStart'), 'flowStart must fire');
    assert.ok(kinds.includes('flowEnd'),   'flowEnd must fire');
  });

  it('fires onRunEnd with lifecycle "completed"', () => {
    assert.equal(session.runEnds.length, 1, 'onRunEnd must fire exactly once');
    const run = session.runEnds[0];
    assert.ok(run !== undefined, 'onRunEnd result must be defined');
    assert.equal(run.lifecycle, 'completed');
  });

  it('fires onArchivistTurn when a draft is produced', () => {
    // The salvage node produces a non-empty draft; onArchivistTurn must fire.
    assert.ok(session.archivistTurns.length >= 1, 'onArchivistTurn must fire for a completed run');
    const draft = session.archivistTurns[0] ?? '';
    assert.ok(draft.length > 0, 'draft must be non-empty');
  });

  it('fires onMemoryChanged at least once', () => {
    assert.ok(session.memoryChangedCount > 0, 'onMemoryChanged must fire during execution');
  });

  it('appends visitor and archivist turns to conversation', () => {
    const conv = session.conversation;
    const visitorTurns   = conv.filter((t) => t.role === 'visitor');
    const archivistTurns = conv.filter((t) => t.role === 'archivist');
    assert.ok(visitorTurns.length   >= 1, 'conversation must contain at least one visitor turn');
    assert.ok(archivistTurns.length >= 1, 'conversation must contain at least one archivist turn');
  });

  it('reads the prompt conversation context from the RDF graph', () => {
    const conv = session.memoryConversation(10);
    assert.deepEqual(conv.map((t) => t.role), session.conversation.map((t) => t.role));
    assert.ok(conv.some((t) => t.text === 'Tell me about books with haunted archives'));
  });

  it('does not fire onError for a successful salvage run', () => {
    assert.equal(session.errors.length, 0, 'no errors expected on the salvage path');
  });

  it('onRunEnd carries the ExecutionResultType for durability', () => {
    const run = session.runEnds[0];
    assert.ok(run !== undefined);
    assert.ok(typeof run.execution === 'object', 'execution result must be present');
    assert.equal(run.dagName, ARCHIVIST_DAG_IRI);
  });

  it('uses the injected clock for conversation timestamps', async () => {
    const counter = VirtualTimeCounter.create({ 'startMs': 10_000 });
    const clock = Clock.create(VirtualClockProvider.create(counter));
    const clockedSession = new HeadlessArchivistSession(
      new MemoryStore(),
      new ConsoleLogger(),
      { 'clock': clock, 'llm': new HeadlessStubLlm() },
    );

    await clockedSession.ask('Tell me about deterministic archive clocks');

    assert.equal(clockedSession.conversation[0]?.ts, 10_000);
  });
});

// ── reset() tests ────────────────────────────────────────────────────────────

describe('ArchivistSession.reset()', () => {
  let session: HeadlessArchivistSession;

  before(async () => {
    session = SessionHarness.make();
    // Seed some conversation so reset() has something to clear.
    await session.ask('First question');
    const priorGreetings = session.greetingsReceived.length;
    await session.reset();
    // Verify reset triggered exactly one more bootstrap cycle.
    assert.ok(session.greetingsReceived.length > priorGreetings, 'reset must re-run greet()');
  }, { timeout: 90_000 });

  it('clears old conversation history on reset and records the new bootstrap turns', () => {
    const roles = session.conversation.map((t) => t.role);
    assert.deepEqual(roles, ['archivist', 'visitor']);
    assert.deepEqual(session.memoryConversation(10).map((t) => t.role), ['archivist', 'visitor']);
  });

  it('fires onReset hook', () => {
    assert.ok(session.resetCount >= 1, 'onReset must be called during reset()');
  });

  it('re-runs greet() after reset', () => {
    // greetingsReceived captures both the initial greet and the post-reset greet.
    assert.ok(session.greetingsReceived.length >= 1, 'greeting must be re-generated after reset');
  });

  it('re-runs sampleReply() after reset', () => {
    assert.ok(session.sampleReplies.length >= 1, 'sample reply must be re-generated after reset');
  });
});

// ── boot() injection-bypass tests ────────────────────────────────────────────

describe('ArchivistSession boot() with injected LLM', () => {
  let session: HeadlessArchivistSession;

  before(async () => {
    session = SessionHarness.make();
    await session.boot();
  }, { timeout: 10_000 });

  it('fires onBackendsReady once', () => {
    assert.equal(session.backendsReadyCalls.length, 1);
  });

  it('reports noModel=false when LLM is injected', () => {
    const call = session.backendsReadyCalls[0];
    assert.ok(call !== undefined);
    assert.equal(call.noModel, false, 'noModel must be false when llm is injected');
  });
});
