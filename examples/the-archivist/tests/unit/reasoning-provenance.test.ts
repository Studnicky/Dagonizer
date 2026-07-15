/**
 * reasoning-provenance: unit tests for Phase D reasoning capture + recall.
 *
 * Exercises two collaborators:
 *   `RdfProvObserver.recordNodeStart/recordNodeEnd/recordReasoning` — writes
 *     each `state.reasoning` step not yet persisted as a `dag:Reasoning`
 *     PROV entity into the run's prov graph, guarded by a run-wide
 *     persisted-count so replays of the same lifecycle never duplicate.
 *   `RecallContextNode` — walks every OTHER run's prov graph, collects
 *     `dag:Reasoning` entities, and surfaces the first one on
 *     `state.recalledContext.priorReasoning` / `.summary`.
 *
 * `RecallContextNode` is exercised through `execute(Batch.of(state), context)`
 * so the test covers the monadic batch contract directly.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { ArchivistState } from '../../ArchivistState.ts';
import { RecallContextNode } from '../../nodes/recallContext.ts';
import { MemoryStore } from '../../memory/MemoryStore.ts';
import { RdfProvObserver } from '../../provenance/RdfProvObserver.ts';
import { DAG_ENT, DAG_PRED, PROV, ProvIris, RDF_TYPE } from '../../provenance/PROV.ts';
import type { ArchivistServices } from '../../services.ts';

import { Clock, VirtualClockProvider, VirtualTimeCounter } from '@studnicky/clock';
import { Batch, ReasoningStep } from '@studnicky/dagonizer';
import { NodeContext } from '@studnicky/dagonizer/entities';

// ── Stub implementations for never-called ArchivistServices ─────────────────

/** Minimal ToolDefinitionType stub used by service properties that are never invoked. */
const STUB_DEFINITION = {
  'name':         'stub',
  'description':  '',
  'inputSchema':  { 'type': 'object' as const },
  'outputSchema': { 'type': 'object' as const },
  'strict':       false,
} satisfies ArchivistServices['webSearch']['definition'];

/** Never-called stub for tool contracts; satisfies ToolInterface. */
class NullTool {
  readonly definition = STUB_DEFINITION;
  async execute(): Promise<never> {
    return Promise.reject(new Error('NullTool.execute: not called in this test'));
  }
}

/** Never-called stub for LlmClientInterface; satisfies all methods. */
class NullLlm {
  async classifyIntent(): Promise<never>     { return Promise.reject(new Error('not called')); }
  async extractTerms(): Promise<never>       { return Promise.reject(new Error('not called')); }
  async decideTools(): Promise<never>        { return Promise.reject(new Error('not called')); }
  async rankCandidates(): Promise<never>     { return Promise.reject(new Error('not called')); }
  async compose(): Promise<never>            { return Promise.reject(new Error('not called')); }
  async composeAuthor(): Promise<never>      { return Promise.reject(new Error('not called')); }
  async composeReviews(): Promise<never>     { return Promise.reject(new Error('not called')); }
  async describeBook(): Promise<never>       { return Promise.reject(new Error('not called')); }
  async composeSimilar(): Promise<never>     { return Promise.reject(new Error('not called')); }
  async validate(): Promise<never>           { return Promise.reject(new Error('not called')); }
  async composeMemoryRecall(): Promise<never>{ return Promise.reject(new Error('not called')); }
  async composeEmptyResponse(): Promise<never>{ return Promise.reject(new Error('not called')); }
  async suggestStarterQuery(): Promise<never>{ return Promise.reject(new Error('not called')); }
  async suggestGreeting(): Promise<never>    { return Promise.reject(new Error('not called')); }
  async suggestVisitorReplyTo(): Promise<never>{ return Promise.reject(new Error('not called')); }
  async explainTool(): Promise<never>        { return Promise.reject(new Error('not called')); }
}

// ── Fixture ──────────────────────────────────────────────────────────────────

/** Setup helpers for the reasoning-provenance unit tests. */
class ReasoningProvFixture {
  static makeRecallNode(memory: MemoryStore): RecallContextNode {
    const services: ArchivistServices = {
      webSearch:        new NullTool(),
      googleBooks:      new NullTool(),
      wikipediaSummary: new NullTool(),
      subjectSearch:    new NullTool(),
      llm:              new NullLlm(),
      memory,
      embedder:         null,
      nodeTimeouts:     {},
    };
    return new RecallContextNode(services);
  }

  static context() {
    return NodeContext.create('test-dag', 'recall-context', new AbortController().signal);
  }

  /** Writes one `dag:Reasoning` PROV entity directly, mirroring what `RdfProvObserver.recordReasoning` writes. */
  static seedPriorReasoningEntity(
    memory: MemoryStore,
    entity: ReturnType<typeof MemoryStore.iri>,
    graph: ReturnType<typeof MemoryStore.provGraphIri>,
    text: string,
    kind: string,
    startedAt: Date,
  ): void {
    memory.assert(entity, RDF_TYPE, DAG_ENT.Reasoning, graph);
    memory.assert(entity, PROV.value, MemoryStore.lit.str(text), graph);
    memory.assert(entity, DAG_PRED.reasoningKind, MemoryStore.lit.str(kind), graph);
    memory.assert(entity, PROV.startedAtTime, MemoryStore.lit.dateTime(startedAt), graph);
  }

  /** Counts the `dag:Reasoning` entities present in one PROV graph. */
  static reasoningEntityCount(
    store: MemoryStore,
    graph: ReturnType<typeof MemoryStore.provGraphIri>,
  ): number {
    return store.select({
      subject:   '?e',
      predicate: RDF_TYPE,
      object:    DAG_ENT.Reasoning,
      graph,
    }).length;
  }
}

// ── RdfProvObserver: reasoning capture ───────────────────────────────────────

void test('RdfProvObserver: records reasoning as dag:Reasoning quads', async () => {
  const store = new MemoryStore();
  const obs = new RdfProvObserver({ store, runId: 'run-a', dispatcherAgentId: 'dispatcher', alreadyPersistedReasoning: [] });
  const state = new ArchivistState();
  state.runId = 'run-a';
  state.reasoning = [
    ReasoningStep.create({ 'kind': 'thought', 'text': 'checking cache' }),
    ReasoningStep.create({ 'kind': 'action', 'tool': 'rankCandidates.llmTiebreak', 'args': { 'candidateCount': 3 } }),
  ];

  obs.recordNodeStart('rank-candidates');
  obs.recordNodeEnd('rank-candidates', undefined, state.reasoning);

  const graph = MemoryStore.provGraphIri('run-a');

  const reasoningEntities = store.select({
    subject:   '?e',
    predicate: RDF_TYPE,
    object:    DAG_ENT.Reasoning,
    graph,
  });
  assert.ok(reasoningEntities.length >= 2, 'at least two reasoning entities recorded');

  const generatedByRows = store.select({
    subject:   '?e',
    predicate: PROV.wasGeneratedBy,
    object:    '?a',
    graph,
  });
  assert.equal(generatedByRows.length, reasoningEntities.length, 'every reasoning entity carries wasGeneratedBy');
  for (const row of generatedByRows) {
    const activity = row['a'];
    assert.ok(activity !== undefined, 'wasGeneratedBy object must be bound');
    assert.ok(
      activity !== undefined && activity.value.startsWith('urn:dagonizer:activity:run-a:rank-candidates:'),
      'wasGeneratedBy must point at the rank-candidates node activity',
    );
  }

  const valueRows = store.select({
    subject:   '?e',
    predicate: PROV.value,
    object:    '?text',
    graph,
  });
  const values = valueRows.map((row) => row['text']?.value);
  assert.ok(values.includes('checking cache'), 'thought text must be recorded');
  assert.ok(
    values.includes('tool:rankCandidates.llmTiebreak args:{"candidateCount":3}'),
    'action step must record the tool:<name> args:<json> mapping',
  );

  const kindRows = store.select({
    subject:   '?e',
    predicate: DAG_PRED.reasoningKind,
    object:    '?k',
    graph,
  });
  const kinds = kindRows.map((row) => row['k']?.value);
  assert.ok(kinds.includes('thought'), 'thought kind recorded');
  assert.ok(kinds.includes('action'), 'action kind recorded');
});

void test('RdfProvObserver: uses the injected substrate clock for PROV timestamps', async () => {
  const store = new MemoryStore();
  const counter = VirtualTimeCounter.create({ 'startMs': 42_000 });
  const clock = Clock.create(VirtualClockProvider.create(counter));
  const obs = new RdfProvObserver({ store, runId: 'run-clock', dispatcherAgentId: 'dispatcher', clock, alreadyPersistedReasoning: [] });

  obs.recordFlowStart('the-archivist');
  obs.recordNodeStart('rank-candidates');
  obs.recordNodeEnd('rank-candidates', 'ranked', []);

  const graph = MemoryStore.provGraphIri('run-clock');
  const nodeActivity = store.select({
    subject:   '?activity',
    predicate: MemoryStore.dagIri('nodeName'),
    object:    MemoryStore.lit.str('rank-candidates'),
    graph,
  })[0]?.['activity'];
  assert.ok(nodeActivity !== undefined, 'node activity is recorded');

  const startedAt = store.select({
    subject:   nodeActivity,
    predicate: PROV.startedAtTime,
    object:    '?timestamp',
    graph,
  })[0]?.['timestamp']?.value;
  const endedAt = store.select({
    subject:   nodeActivity,
    predicate: PROV.endedAtTime,
    object:    '?timestamp',
    graph,
  })[0]?.['timestamp']?.value;

  assert.equal(startedAt, new Date(42_000).toISOString());
  assert.equal(endedAt, new Date(42_000).toISOString());
});

void test('RdfProvObserver: idempotent on duplicate lifecycle fire', async () => {
  const store = new MemoryStore();
  const obs = new RdfProvObserver({ store, runId: 'run-b', dispatcherAgentId: 'dispatcher', alreadyPersistedReasoning: [] });
  const state = new ArchivistState();
  state.runId = 'run-b';
  state.reasoning = [
    ReasoningStep.create({ 'kind': 'thought', 'text': 'first pass' }),
    ReasoningStep.create({ 'kind': 'action', 'tool': 'webSearch.query', 'args': { 'query': 'Piranesi' } }),
  ];

  const graph = MemoryStore.provGraphIri('run-b');

  obs.recordNodeStart('n');
  obs.recordNodeEnd('n', undefined, state.reasoning);
  const firstCount = ReasoningProvFixture.reasoningEntityCount(store, graph);
  assert.ok(firstCount > 0, 'first lifecycle fire persists reasoning entities');

  obs.recordNodeStart('n');
  obs.recordNodeEnd('n', undefined, state.reasoning);
  const secondCount = ReasoningProvFixture.reasoningEntityCount(store, graph);

  assert.equal(secondCount, firstCount, 'duplicate lifecycle fire with the same reasoning array adds no new entities');
});

// ── RecallContextNode: recall surfaces prior-run reasoning ───────────────────

void test('RecallContextNode: recall surfaces prior-run reasoning', async () => {
  const memory = new MemoryStore();

  // Seed a prior run's PROV graph directly with two dag:Reasoning entities.
  const priorGraph = MemoryStore.provGraphIri('prior-1');
  ReasoningProvFixture.seedPriorReasoningEntity(
    memory,
    ProvIris.reasoning('prior-1', 0),
    priorGraph,
    'recalled thought text',
    'thought',
    new Date('2026-01-01T00:00:01.000Z'),
  );
  ReasoningProvFixture.seedPriorReasoningEntity(
    memory,
    ProvIris.reasoning('prior-1', 1),
    priorGraph,
    'recalled second thought',
    'thought',
    new Date('2026-01-01T00:00:00.000Z'),
  );

  const node = ReasoningProvFixture.makeRecallNode(memory);
  const state = new ArchivistState();
  state.runId = 'current-1';
  state.query = 'existentialism fiction';
  state.terms = ['existentialism', 'fiction'];

  const routed = await node.execute(Batch.of(state), ReasoningProvFixture.context());
  assert.equal(routed.get('recalled')?.size, 1, 'state routes to recalled');

  assert.ok(state.recalledContext.priorReasoning.length >= 1, 'at least one prior reasoning step recalled');
  const recalled = state.recalledContext.priorReasoning.find((r) => r.text === 'recalled thought text');
  assert.ok(recalled !== undefined, 'recalled thought text must be present');
  assert.equal(recalled?.kind, 'thought', 'recalled reasoning kind must be thought');

  assert.ok(
    state.recalledContext.summary.includes('recalled thought text'),
    'summary must cite the top recalled reasoning text',
  );
});

// ── RdfProvObserver: HITL park/resume continuity (BUG #1 regression) ────────

void test('RdfProvObserver: resume observer does not re-persist pre-park reasoning and continues the causal chain', async () => {
  const store = new MemoryStore();
  const runId = 'run-resume';
  const graph = MemoryStore.provGraphIri(runId);

  // ── Pre-park run: a fresh observer records two reasoning steps ──────────
  const preParkObserver = new RdfProvObserver({
    store, runId, dispatcherAgentId: 'dispatcher', alreadyPersistedReasoning: [],
  });
  const state = new ArchivistState();
  state.runId = runId;
  state.reasoning = [
    ReasoningStep.create({ 'kind': 'thought', 'text': 'pre-park step 0' }),
    ReasoningStep.create({ 'kind': 'thought', 'text': 'pre-park step 1' }),
  ];
  preParkObserver.recordNodeStart('classify-intent');
  preParkObserver.recordNodeEnd('classify-intent', undefined, state.reasoning);

  const afterParkCount = ReasoningProvFixture.reasoningEntityCount(store, graph);
  assert.equal(afterParkCount, 2, 'pre-park run persists exactly its two reasoning steps');

  // ── HITL parks here; a checkpoint captures `state` (runId + reasoning
  // survive the graph round-trip. On
  // resume, `ArchivistSession.resumeRun` restores the SAME runId and builds
  // a NEW `RdfProvObserver` instance seeded with the already-persisted
  // reasoning so it never re-derives or re-writes the pre-park steps. ──────
  const resumeObserver = new RdfProvObserver({
    store, runId, dispatcherAgentId: 'dispatcher', alreadyPersistedReasoning: state.reasoning,
  });

  // The visitor's reply resolves the park; a new node appends one more
  // reasoning step on top of the two restored ones.
  state.reasoning = [...state.reasoning, ReasoningStep.create({ 'kind': 'thought', 'text': 'post-resume step 2' })];

  resumeObserver.recordNodeStart('compose-response');
  resumeObserver.recordNodeEnd('compose-response', undefined, state.reasoning);

  // (a) No duplicate quads for the two pre-park steps: total stays at 3
  // (2 pre-park + 1 new), not 5 (2 pre-park + 2 re-persisted + 1 new).
  const afterResumeCount = ReasoningProvFixture.reasoningEntityCount(store, graph);
  assert.equal(afterResumeCount, 3, 'resume observer adds exactly one new reasoning entity, no duplicates');

  // (b) The genuinely new post-resume step IS persisted, and its
  // `wasInformedBy` links to the last PRE-PARK entity (index 1), not to
  // nothing (a disconnected chain) and not to a re-derived duplicate.
  const newEntity = ProvIris.reasoning(runId, 2);
  const lastPreParkEntity = ProvIris.reasoning(runId, 1);
  const informedByRows = store.select({
    subject:   newEntity,
    predicate: PROV.wasInformedBy,
    object:    '?prior',
    graph,
  });
  assert.equal(informedByRows.length, 1, 'the new post-resume entity carries exactly one wasInformedBy link');
  assert.equal(
    informedByRows[0]?.['prior']?.value,
    lastPreParkEntity.value,
    'the new post-resume entity is informed by the last pre-park reasoning entity, continuing the causal chain',
  );

  // (c) `wasGeneratedBy` attributes the new entity to the resume run's own
  // `compose-response` node activity, not to the pre-park `classify-intent`
  // activity.
  const generatedByRows = store.select({
    subject:   newEntity,
    predicate: PROV.wasGeneratedBy,
    object:    '?activity',
    graph,
  });
  assert.equal(generatedByRows.length, 1, 'the new entity carries exactly one wasGeneratedBy link');
  assert.ok(
    generatedByRows[0]?.['activity']?.value.startsWith(`urn:dagonizer:activity:${runId}:compose-response:`),
    'the new entity is attributed to the resume run\'s compose-response activity',
  );

  // The two pre-park entities keep their original wasGeneratedBy binding to
  // classify-intent — resume must not rewrite their attribution either.
  const preParkEntity0 = ProvIris.reasoning(runId, 0);
  const preParkGeneratedByRows = store.select({
    subject:   preParkEntity0,
    predicate: PROV.wasGeneratedBy,
    object:    '?activity',
    graph,
  });
  assert.equal(preParkGeneratedByRows.length, 1, 'pre-park entity attribution is untouched by resume');
  assert.ok(
    preParkGeneratedByRows[0]?.['activity']?.value.startsWith(`urn:dagonizer:activity:${runId}:classify-intent:`),
    'pre-park entity remains attributed to the original classify-intent activity',
  );
});
