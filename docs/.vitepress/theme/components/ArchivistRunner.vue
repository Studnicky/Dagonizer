<script setup lang="ts">
/**
 * ArchivistRunner — orchestrator for the in-browser Archivist demo.
 *
 * Two-column iridis-style layout with container-query breakpoint:
 *
 *   ┌──────────────────────────────────────────────────────────────────────┐
 *   │ <single-column on narrow; two-column at ≥720px container width>      │
 *   ├──────────────────────────┬───────────────────────────────────────────┤
 *   │ LEFT COL                  │ RIGHT COL                                │
 *   │ tabs: Conversation|Config │ tabs: DAG | Memory | Trace               │
 *   └──────────────────────────┴───────────────────────────────────────────┘
 *
 * Pure observer: the dispatcher's lifecycle hooks toggle CSS classes on
 * cytoscape nodes / edges via the DagGraph's imperative surface — no
 * setTimeout, no polling, no JS-driven animation loops.
 */

import { computed, onMounted, ref, watch } from 'vue';
import type { ElementDefinition } from 'cytoscape';

import { Checkpoint } from '@noocodex/dagonizer/checkpoint';
import type { ExecutionResultInterface } from '@noocodex/dagonizer';

import { CytoscapeRenderer } from '../../../../src/viz/CytoscapeRenderer.ts';

import { ArchivistState } from '../../../../examples/the-archivist/ArchivistState.ts';
import { archivistDAG } from '../../../../examples/the-archivist/dag.ts';
import { ConsoleLogger } from '../../../../examples/the-archivist/logger/ConsoleLogger.ts';
import { MemoryStore } from '../../../../examples/the-archivist/memory/MemoryStore.ts';
import { ONTOLOGY_NTRIPLES } from '../../../../examples/the-archivist/ontology/ArchivistOntology.ts';
import { RdfProvObserver } from '../../../../examples/the-archivist/provenance/RdfProvObserver.ts';
import { StateProjection } from '../../../../examples/the-archivist/state/StateProjection.ts';
import { NODE_KINDS } from '../../../../examples/the-archivist/nodes/ArchivistNode.ts';
import { classifyIntent } from '../../../../examples/the-archivist/nodes/classifyIntent.ts';
import { decideTools } from '../../../../examples/the-archivist/nodes/decideTools.ts';
import { extractQuery } from '../../../../examples/the-archivist/nodes/extractQuery.ts';
import { groupByYear } from '../../../../examples/the-archivist/nodes/groupByYear.ts';
import { hasCitationsGate } from '../../../../examples/the-archivist/nodes/hasCitationsGate.ts';
import { mergeCandidates } from '../../../../examples/the-archivist/nodes/mergeCandidates.ts';
import { rankByRating } from '../../../../examples/the-archivist/nodes/rankByRating.ts';
import { pickBestMatch } from '../../../../examples/the-archivist/nodes/pickBestMatch.ts';
import { recallContext } from '../../../../examples/the-archivist/nodes/recallContext.ts';
import { recallMemories } from '../../../../examples/the-archivist/nodes/recallMemories.ts';
import { composeMemoryResponse } from '../../../../examples/the-archivist/nodes/composeMemoryResponse.ts';
import { recallPastVisits } from '../../../../examples/the-archivist/nodes/recallPastVisits.ts';
import { recommendSimilar } from '../../../../examples/the-archivist/nodes/recommendSimilar.ts';
import { recordFindings } from '../../../../examples/the-archivist/nodes/recordFindings.ts';
import { composeResponse, validateResponse } from '../../../../examples/the-archivist/nodes/composeResponse.ts';
import { rankCandidates } from '../../../../examples/the-archivist/nodes/rankCandidates.ts';
import { composeEmptyResponse, declineEmpty, declineOffTopic, respondToVisitor } from '../../../../examples/the-archivist/nodes/respondToVisitor.ts';
import { webSearchScout, openLibraryScout, googleBooksScout, subjectScout, wikipediaScout } from '../../../../examples/the-archivist/nodes/scouts.ts';
import { detectBackends, hasNoRunnableModel, instantiateProvider, loadApiKeys, pickBestBackend, saveApiKeys } from '../../../../examples/the-archivist/providers/index.ts';
import { MobileDetection } from '../../../../examples/the-archivist/providers/MobileDetection.ts';
import type { BackendAvailability, ProviderId } from '../../../../examples/the-archivist/providers/index.ts';
import type { ArchivistServices } from '../../../../examples/the-archivist/services.ts';
import { GoogleBooksTool } from '../../../../examples/the-archivist/tools/GoogleBooksTool.ts';
import { OpenLibrarySearchTool } from '../../../../examples/the-archivist/tools/OpenLibrarySearchTool.ts';
import { SubjectSearchTool } from '../../../../examples/the-archivist/tools/SubjectSearchTool.ts';
import { WikipediaSummaryTool } from '../../../../examples/the-archivist/tools/WikipediaSummaryTool.ts';
import {
  BookSearchFanoutDAG,
  registerBookSearchFanoutNodes,
} from '../../../../examples/the-archivist/deepdags/BookSearchFanoutDAG.ts';
import {
  ComposeRetryLoopDAG,
  registerComposeRetryLoopNodes,
} from '../../../../examples/the-archivist/deepdags/ComposeRetryLoopDAG.ts';

import { ObservedDagonizer } from './ObservedDagonizer.ts';
import BackendPicker from './BackendPicker.vue';
import CheckpointControls from './CheckpointControls.vue';
import Conversation from './Conversation.vue';
import DagGraph from './DagGraph.vue';
import MemoryGraph from './MemoryGraph.vue';
import type { MemorySelection } from './MemoryGraph.vue';
import PanesTabs from './PanesTabs.vue';
import SendForm from './SendForm.vue';
import TimeoutPane from './TimeoutPane.vue';
import type { TimeoutSettings } from './TimeoutPane.vue';
import ToolExplainPanel from './ToolExplainPanel.vue';
import TraceFeed from './TraceFeed.vue';
import TripleInspector from './TripleInspector.vue';

import { RunnerMachine } from '../runner/RunnerMachine.ts';

// ── State ───────────────────────────────────────────────────────────────
const backends = ref<readonly BackendAvailability[]>([]);
const activeBackend = ref<ProviderId>('gemini-nano');
const noModel = ref(false);
const isMobile = ref(false);
const apiKeys = ref<Partial<Record<ProviderId, string>>>(loadApiKeys());
const visitorQuery = ref('');
const isRunning = ref(false);
const conversation = ref<Array<{ role: 'visitor' | 'archivist'; text: string; ts: number }>>([]);
const trace = ref<Array<{ node: string; output?: string; ts: number; kind: 'start' | 'end' | 'error' }>>([]);
const terminalKind = ref<'pending' | 'completed' | 'failed' | 'cancelled' | 'timed_out'>('pending');

const dagGraph = ref<InstanceType<typeof DagGraph> | null>(null);
const memoryStore = new MemoryStore();
memoryStore.enablePersistence();
const memoryTick = ref(0); // bumped after each write so MemoryGraph re-renders
const isPersisted = ref(memoryStore.isPersisted);
const logger = new ConsoleLogger();

// ── Timeout settings ─────────────────────────────────────────────────────
const timeoutSettings = ref<TimeoutSettings>({
  'composeMs':   60_000,
  'webSearchMs': 60_000,
  'rankMs':      30_000,
});

function onTimeoutSettingsUpdate(settings: TimeoutSettings): void {
  timeoutSettings.value = settings;
}

/**
 * Overall safety-net deadline: sum of all per-phase budgets plus a small
 * grace window. Per-node timeouts are the primary mechanism — this is a
 * last-resort hard stop for nodes that do not declare their own budget.
 */
function overallDeadlineMs(): number {
  const { composeMs, webSearchMs, rankMs } = timeoutSettings.value;
  const grace = 5_000;
  return composeMs + webSearchMs + rankMs + grace;
}

// ── Cancel button ────────────────────────────────────────────────────────
let activeAbortController: AbortController | null = null;

function cancel(): void {
  if (activeAbortController !== null) {
    activeAbortController.abort(new Error('cancelled by visitor'));
  }
}

// ── Checkpoint ───────────────────────────────────────────────────────────
const CHECKPOINT_KEY = 'dagonizer-archivist-checkpoint';
const checkpointNode = ref<string | null>(null);
const hasCheckpoint = ref(
  typeof localStorage !== 'undefined' && localStorage.getItem('dagonizer-archivist-checkpoint') !== null
);
let lastResult: ExecutionResultInterface<ArchivistState> | null = null;
let lastDagName = 'the-archivist';

function saveCheckpoint(): void {
  if (lastResult === null || lastResult.cursor === null) {
    logger.warn('no resumable checkpoint available (run completed fully, or no run yet)');
    return;
  }
  try {
    const data = Checkpoint.from(lastDagName, lastResult);
    const json = Checkpoint.toJson(data);
    localStorage.setItem(CHECKPOINT_KEY, json);
    checkpointNode.value = lastResult.cursor;
    hasCheckpoint.value = true;
    dagGraph.value?.setCompleted(lastResult.cursor);
    trace.value = [...trace.value, {
      'node': lastResult.cursor,
      'ts': Date.now(),
      'kind': 'end',
      'output': 'checkpoint saved',
    }];
    logger.info(`checkpoint saved at ${lastResult.cursor}`);
  } catch (err) {
    logger.warn(`checkpoint failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function resumeFromCheckpoint(): Promise<void> {
  if (isRunning.value) return;
  const raw = typeof localStorage !== 'undefined'
    ? localStorage.getItem(CHECKPOINT_KEY)
    : null;
  if (raw === null) {
    logger.warn('no checkpoint found in localStorage');
    return;
  }
  let restored: { state: ArchivistState; dagName: string; cursor: string } | null = null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    restored = Checkpoint.restore(parsed, (snap) => ArchivistState.restore(snap)) as {
      state: ArchivistState;
      dagName: string;
      cursor: string;
    };
  } catch (err) {
    logger.warn(`checkpoint restore failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  runnerMachine.dispatch({ 'type': 'submit' });
  isRunning.value = true;
  terminalKind.value = 'pending';
  trace.value = [];
  await dagGraph.value?.reset();
  memoryTick.value++;
  logger.clear();
  logger.info(`resuming from checkpoint at node: ${restored.cursor}`);

  const runId = restored.state.runId !== ''
    ? restored.state.runId
    : (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `r-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;

  const prov = new RdfProvObserver({
    'store':              memoryStore,
    'runId':              runId,
    'dispatcherAgentId':  `dispatcher:${activeBackend.value}`,
  });

  const services = buildServices();
  const dispatcher = new ObservedDagonizer<ArchivistState, ArchivistServices>({
    services,
    'observer': buildObserver(restored.cursor, prov),
  });

  // Register deep-DAGs (molecular pattern)
  registerBookSearchFanoutNodes(dispatcher);
  dispatcher.registerDAG(BookSearchFanoutDAG);
  registerComposeRetryLoopNodes(dispatcher);
  dispatcher.registerDAG(ComposeRetryLoopDAG);

  for (const node of [
    recallContext,
    classifyIntent, extractQuery, decideTools,
    webSearchScout, openLibraryScout, googleBooksScout, subjectScout, wikipediaScout,
    rankByRating, pickBestMatch,
    mergeCandidates, recordFindings, hasCitationsGate,
    recallPastVisits, groupByYear, recommendSimilar,
    // recall-memories branch
    recallMemories, composeMemoryResponse, respondToVisitor,
    declineOffTopic, declineEmpty,
    // empty-result LLM response branch
    composeEmptyResponse,
  ]) dispatcher.registerNode(node);
  dispatcher.registerDAG(archivistDAG);

  activeAbortController = new AbortController();
  const deadlineMs = overallDeadlineMs();

  try {
    await dispatcher.resume(
      restored.dagName,
      restored.state,
      restored.cursor,
      { 'signal': activeAbortController.signal, 'deadlineMs': deadlineMs },
    );
  } catch (error) {
    conversation.value = [...conversation.value, {
      'role': 'archivist',
      'text': `(error: ${error instanceof Error ? error.message : String(error)})`,
      'ts': Date.now(),
    }];
  } finally {
    await dispatcher.destroy();
    activeAbortController = null;
    isRunning.value = false;
  }
}

// ── Persistence toggle ───────────────────────────────────────────────────
function togglePersistence(): void {
  if (memoryStore.isPersisted) {
    memoryStore.disablePersistence();
    isPersisted.value = false;
    logger.info('memory store: switched to in-memory mode (localStorage dump removed)');
  } else {
    memoryStore.enablePersistence();
    isPersisted.value = true;
    logger.info('memory store: switched to persisted mode');
  }
  memoryTick.value++;
}

// UI state machine — runner subscribes; views derive UI from the
// machine's current state instead of independent refs.
const runnerMachine = new RunnerMachine();

// Selected node in the memory graph — TripleInspector reads this.
const selectedSelection = ref<MemorySelection | null>(null);
function onMemorySelect(sel: MemorySelection | null): void { selectedSelection.value = sel; }

// Selected tool/node for the ToolExplainPanel.
const selectedTool = ref<string | null>(null);
function onToolSelect(name: string): void { selectedTool.value = name; }

/**
 * Static context fed to the LLM prompt for each known tool/node.
 * Keyed by the node name as it appears in the DAG element data.
 */
const toolContextMap: Record<string, string> = {
  'open-library-scout':  'Searches OpenLibrary for books by free-text query and returns normalized Candidate records.',
  'google-books-scout':  'Searches Google Books API and returns Candidate records with ratings and ratingsCount.',
  'subject-scout':       'OpenLibrary subjects search — finds books by theme/topic, not title.',
  'wikipedia-scout':     'Wikipedia page summary — enrichment context for any topic or book.',
  'recall-context':      'SPARQL queries the persistent memory graph for prior intents and recently-seen books to inform classification.',
  'classify-intent':     'LLM classifies the visitor message into one of: on-topic, lookup-author, find-reviews, describe-book, recommend-similar, recall-memories, off-topic.',
  'decide-tools':        'LLM picks which search tools to call based on the classified intent and the visitor query.',
  'rank-candidates':     'LLM ranks the merged candidate list 0..1 by relevance to the query.',
  'merge-candidates':    'Dedupes candidates across sources via CanonicalId (ISBN-13 → ISBN-10 → urn:work:<title>::<author>).',
  'compose-response':    'LLM composes the final visitor reply in the Archivist persona.',
  'validate-response':   'LLM judges whether the draft response is good enough or needs another attempt.',
  'record-findings':     'Writes the ranked shortlist into the persistent memory graph as RDF triples.',
  'recall-past-visits':  'SPARQL queries memory for previously recommended books to seed the similarity prompt.',
  'recall-memories':     'Assembles a structured digest of books, intents, and counts from the memory graph.',
  'compose-memory-response': 'LLM composes a warm prose summary of what the Archivist remembers from prior sessions.',
  'recommend-similar':   'LLM composes a recommend-similar reply anchored on persistent memory facts.',
  'has-citations-gate':  'Deterministic gate — checks whether the shortlist has at least one citation before composing.',
  'decline-off-topic':   'Emits a polite in-character refusal for questions outside the book domain.',
  'decline-empty':       'Emits an in-character acknowledgment when all scouts returned no candidates.',
  'compose-empty-response': 'LLM composes a graceful not-found response that names what was searched and suggests an alternative.',
  'extract-query':       'Deterministic node — copies the visitor query into state for the scout phase.',
  'group-by-year':       'Groups candidates by first-publish year for chronological author-survey display.',
  'pick-best-match':     'Deterministic node — picks the highest-scored candidate from the ranked list.',
  'rank-by-rating':      'Sorts candidates by Google Books rating signal (rating × log(ratingsCount)) for the find-reviews branch.',
  'respond-to-visitor':  'Routes the composed draft into the conversation output and marks the lifecycle as completed.',
};

/** Live LLM client reference — kept in sync with activeBackend changes. */
const currentLlm = computed(() =>
  instantiateProvider(activeBackend.value, { 'apiKeys': apiKeys.value })
);

function clearMemory(): void {
  memoryStore.clear();
  memoryTick.value++;
  logger.info('memory store cleared');
}

// Re-detect backend availability when apiKeys change.
watch(apiKeys, async () => {
  backends.value = await detectBackends({ 'apiKeys': apiKeys.value });
  noModel.value = hasNoRunnableModel(backends.value, { 'isMobile': isMobile.value });
}, { 'deep': true });

// ── Left-column tabs: Conversation | Config ──────────────────────────────
const leftTabs = computed(() => [
  { 'key': 'conversation', 'label': 'Conversation', 'badge': '', 'tone': 'default' as const },
  { 'key': 'config',       'label': 'Config',       'badge': '', 'tone': 'default' as const },
]);

// ── Right-column tabs: DAG | Memory | Trace ──────────────────────────────
const rightTabs = computed(() => {
  const traceCount = trace.value.length + logger.history().length;
  return [
    { 'key': 'dag',    'label': 'DAG',    'badge': isRunning.value ? 'live' : '',   'tone': (isRunning.value ? 'live' : 'default') as 'live' | 'default' },
    { 'key': 'memory', 'label': 'Memory', 'badge': String(memoryStore.size || ''), 'tone': 'accent' as const },
    { 'key': 'trace',  'label': 'Trace',  'badge': String(traceCount || ''),        'tone': (isRunning.value ? 'live' : 'default') as 'live' | 'default' },
  ];
});

const dagElements = computed<ElementDefinition[]>(() => {
  // Deep-DAG registry: placements whose dag name appears here are expanded
  // inline in the Cytoscape diagram — full compound-graph children visible,
  // no opaque boxes. This is the renderer-side of molecular composition.
  const deepDagRegistry = new Map([
    ['book-search-fanout', BookSearchFanoutDAG],
    ['compose-retry-loop', ComposeRetryLoopDAG],
  ]);
  const raw = CytoscapeRenderer.render(archivistDAG, { 'deepDags': deepDagRegistry }) as ElementDefinition[];
  return raw.map((el) => {
    const data = el.data as { id?: string; node?: string };
    const nodeName = data.node ?? data.id;
    const kind = nodeName !== undefined ? NODE_KINDS[nodeName] : undefined;
    if (kind === undefined) return el;
    return { ...el, data: { ...el.data, kind } };
  });
});

function buildServices(): ArchivistServices {
  return {
    'webSearch':         OpenLibrarySearchTool,
    'googleBooks':       GoogleBooksTool,
    'subjectSearch':     SubjectSearchTool,
    'wikipediaSummary':  WikipediaSummaryTool,
    'memory':            memoryStore,
    'llm':               instantiateProvider(activeBackend.value, { 'apiKeys': apiKeys.value }),
    'logger':            logger,
  };
}

/**
 * Shared observer used by both `ask()` (fresh run) and
 * `resumeFromCheckpoint()` (resume from a cursor).
 */
function buildObserver(fromCursor: string | null, prov: RdfProvObserver) {
  return {
    onFlowStart(dagName: string) {
      // reset() is awaited by the caller (ask / resumeFromCheckpoint) before
      // execute() fires, so the fade-out completes before this point.
      if (fromCursor !== null) dagGraph.value?.setActive(fromCursor);
      prov.recordFlowStart(dagName);
    },
    onNodeStart(nodeName: string) {
      trace.value = [...trace.value, { 'node': nodeName, 'ts': Date.now(), 'kind': 'start' }];
      dagGraph.value?.setActive(nodeName);
      prov.recordNodeStart(nodeName);
      runnerMachine.pulse({ 'type': 'nodeStart', 'node': nodeName });
    },
    onNodeEnd(nodeName: string, output: string | undefined, state: ArchivistState) {
      trace.value = [...trace.value, { 'node': nodeName, output, 'ts': Date.now(), 'kind': 'end' }];
      dagGraph.value?.setCompleted(nodeName);
      if (output !== undefined) dagGraph.value?.markEdgeTraversed(nodeName, output);
      StateProjection.project(state, memoryStore);
      prov.recordNodeEnd(nodeName, output);
      memoryTick.value++;
      runnerMachine.pulse(output === undefined
        ? { 'type': 'nodeEnd', 'node': nodeName }
        : { 'type': 'nodeEnd', 'node': nodeName, 'output': output });
    },
    onError(nodeName: string, error: Error) {
      trace.value = [...trace.value, { 'node': nodeName, 'ts': Date.now(), 'kind': 'error' }];
      dagGraph.value?.setErrored(nodeName);
      prov.recordError(nodeName, error);
      runnerMachine.pulse({ 'type': 'nodeError', 'node': nodeName, 'error': error });
    },
    onFlowEnd(_dagName: string, state: ArchivistState, result: { cursor: string | null }) {
      const kind = state.lifecycle.kind;
      if (kind === 'completed' || kind === 'failed' || kind === 'cancelled' || kind === 'timed_out') {
        terminalKind.value = kind;
      }
      if (state.draft.length > 0) {
        conversation.value = [...conversation.value, {
          'role': 'archivist',
          'text': state.draft,
          'ts': Date.now(),
        }];
      }
      lastResult = result as never;
      lastDagName = _dagName;
      if (result.cursor !== null) checkpointNode.value = result.cursor;
      prov.recordFlowEnd(kind);
      memoryTick.value++;
      logger.result(`intent=${state.intent} · shortlist=${String(state.shortlist.length)} · triples=${String(memoryStore.size)} · lifecycle=${kind}`);
      runnerMachine.dispatch({ 'type': 'flowEnd', 'lifecycle': kind });
    },
  };
}

// ── Static fallback pools ────────────────────────────────────────────────
const STATIC_GREETINGS: readonly string[] = [
  'Welcome to the shop. The shelves remember everything they hold. What brings you in?',
  'Stay a while. I have a long list of books and a longer one of questions about them.',
  'A reader, then. Tell me what you are looking for, and I will see what the catalog gives up.',
  'The door is always open here. Name a title, an author, or a feeling, and I will look.',
  'Good to see you. The shelves run deep on every subject — where would you like to begin?',
  'Come in. I keep records on almost everything ever printed. What can I find for you?',
  'Every visitor arrives with a question worth answering. What is yours?',
];

const STATIC_VISITOR_REPLIES: readonly string[] = [
  'Something like Neuromancer but written in the last five years?',
  'Where should I start with Stanisław Lem?',
  'A novel about time that doesn\'t lean on time-travel tropes.',
  'Anything Wittgenstein-adjacent that doesn\'t require a logic background?',
  'What\'s the best translation of the Three Body Problem trilogy?',
  'Do you have anything that pairs Ted Chiang with Borges?',
  'Philosophy for someone who just finished Annihilation.',
];

function isFreshSession(): boolean {
  // A fresh session has at most one entry — the archivist greeting (or nothing yet).
  // Once the visitor has sent any message the session is no longer fresh.
  const turns = conversation.value;
  return turns.length === 0 || (turns.length === 1 && turns[0]?.role === 'archivist');
}

function onTreatAsDesktop(): void {
  MobileDetection.setOverride('desktop');
  window.location.reload();
}

// ── Boot ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  memoryStore.loadOntology(ONTOLOGY_NTRIPLES);
  memoryTick.value++;

  isMobile.value = MobileDetection.isLikelyMobile();

  backends.value = await detectBackends({ 'apiKeys': apiKeys.value });

  // On mobile, hasNoRunnableModel always returns false (stub is the floor).
  // On desktop, it returns true when no real backend is runnable.
  if (hasNoRunnableModel(backends.value, { 'isMobile': isMobile.value })) {
    noModel.value = true;
    logger.warn('no LLM backend detected — visitor must enable one');
    return;
  }
  noModel.value = false;

  // pickBestBackend falls back to stub on mobile when no cloud key is set.
  const picked = pickBestBackend(backends.value, { 'isMobile': isMobile.value });
  if (picked !== null) {
    activeBackend.value = picked.id;
    logger.info(`backend: ${picked.displayName}`);
  }

  // On a fresh session: generate the Archivist greeting, push it to the
  // conversation, then generate a contextual visitor reply and pre-fill
  // the input. Only runs once per session — once the visitor sends a
  // message the input is cleared (via ask()) and this condition no longer fires.
  if (isFreshSession() && visitorQuery.value.length === 0) {
    const llm = instantiateProvider(activeBackend.value, { 'apiKeys': apiKeys.value });

    // Step 1: generate greeting.
    let greeting = STATIC_GREETINGS[Date.now() % STATIC_GREETINGS.length] as string;
    try {
      const generated = await llm.suggestGreeting();
      if (generated.length > 0) greeting = generated;
    } catch { /* use static fallback */ }

    if (isFreshSession()) {
      conversation.value = [{ 'role': 'archivist', 'text': greeting, 'ts': Date.now() }];
    }

    // Step 2: generate a visitor reply keyed to the greeting.
    if (isFreshSession() && visitorQuery.value.length === 0) {
      try {
        const reply = await llm.suggestVisitorReplyTo(greeting);
        if (reply.length > 0 && isFreshSession() && visitorQuery.value.length === 0) {
          visitorQuery.value = reply;
        }
      } catch {
        visitorQuery.value = STATIC_VISITOR_REPLIES[Date.now() % STATIC_VISITOR_REPLIES.length] as string;
      }
    }
  }
});

watch(apiKeys, () => { saveApiKeys(apiKeys.value); }, { 'deep': true });

// ── Run ──────────────────────────────────────────────────────────────────
async function ask(): Promise<void> {
  if (isRunning.value || visitorQuery.value.trim().length === 0) return;
  runnerMachine.dispatch({ 'type': 'submit' });
  isRunning.value = true;
  terminalKind.value = 'pending';
  trace.value = [];

  const queryText = visitorQuery.value;
  conversation.value = [...conversation.value, {
    'role': 'visitor',
    'text': queryText,
    'ts': Date.now(),
  }];
  // Clear the input immediately after capturing — the send-and-clear pattern.
  visitorQuery.value = '';

  await dagGraph.value?.reset();
  memoryTick.value++;
  logger.clear();
  logger.info(`run start — query: "${queryText}"`);

  const runId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `r-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;
  StateProjection.clear(runId, memoryStore);
  const prov = new RdfProvObserver({
    'store':              memoryStore,
    'runId':              runId,
    'dispatcherAgentId':  `dispatcher:${activeBackend.value}`,
  });

  const services = buildServices();
  const dispatcher = new ObservedDagonizer<ArchivistState, ArchivistServices>({
    services,
    'observer': buildObserver(null, prov),
  });

  const { composeMs, webSearchMs, rankMs } = timeoutSettings.value;

  // Register deep-DAGs first (molecular pattern) — each helper registers the
  // base nodes needed by that deep-DAG. Then re-register timeout-overridden
  // versions which overwrite the base entries in the node map.
  registerBookSearchFanoutNodes(dispatcher);
  dispatcher.registerDAG(BookSearchFanoutDAG);
  registerComposeRetryLoopNodes(dispatcher);
  dispatcher.registerDAG(ComposeRetryLoopDAG);

  // Timeout overrides — re-register after DAG registration (validation already
  // passed; execution looks up nodes from the map at run time, so overwriting
  // here applies the configured budget to every subsequent execution).
  const composeNode          = { ...composeResponse,     'timeoutMs': composeMs };
  const composeEmptyNode     = { ...composeEmptyResponse, 'timeoutMs': composeMs };
  const rankNode             = { ...rankCandidates,       'timeoutMs': rankMs };
  const scoutNode            = { ...webSearchScout,        'timeoutMs': webSearchMs };
  const olScoutNode          = { ...openLibraryScout,      'timeoutMs': webSearchMs };
  const gbScoutNode          = { ...googleBooksScout,      'timeoutMs': webSearchMs };
  const subjectScoutNode     = { ...subjectScout,          'timeoutMs': webSearchMs };
  const wikiScoutNode        = { ...wikipediaScout,        'timeoutMs': webSearchMs };
  for (const node of [composeNode, composeEmptyNode, rankNode, scoutNode, olScoutNode, gbScoutNode, subjectScoutNode, wikiScoutNode]) {
    dispatcher.registerNode(node);
  }

  for (const node of [
    recallContext,
    classifyIntent, extractQuery, decideTools,
    rankByRating, pickBestMatch,
    mergeCandidates, recordFindings, hasCitationsGate,
    groupByYear, recallPastVisits, recommendSimilar,
    // recall-memories branch
    recallMemories, composeMemoryResponse, respondToVisitor,
    declineOffTopic, declineEmpty,
    // empty-result LLM response branch
    composeEmptyResponse,
  ]) dispatcher.registerNode(node);
  dispatcher.registerDAG(archivistDAG);

  const visitor = new ArchivistState();
  visitor.query = queryText;
  visitor.runId = runId;

  activeAbortController = new AbortController();
  const deadlineMs = overallDeadlineMs();

  try {
    await dispatcher.execute(
      'the-archivist',
      visitor,
      { 'signal': activeAbortController.signal, 'deadlineMs': deadlineMs },
    );
  } catch (error) {
    conversation.value = [...conversation.value, {
      'role': 'archivist',
      'text': `(error: ${error instanceof Error ? error.message : String(error)})`,
      'ts': Date.now(),
    }];
  } finally {
    await dispatcher.destroy();
    activeAbortController = null;
    isRunning.value = false;
  }
}

function reset(): void {
  conversation.value = [];
  trace.value = [];
  terminalKind.value = 'pending';
  selectedSelection.value = null;
  selectedTool.value = null;
  checkpointNode.value = null;
  lastResult = null;
  visitorQuery.value = '';
  // Fire-and-forget: the manual reset button is not starting a new run,
  // so no need to await — the fade plays visually but nothing depends on it.
  void dagGraph.value?.reset();
  memoryStore.clear();
  memoryStore.loadOntology(ONTOLOGY_NTRIPLES);
  memoryTick.value++;
  logger.clear();
  runnerMachine.dispatch({ 'type': 'reset' });

  // Regenerate greeting + visitor reply after reset, same as onMounted.
  const llm = instantiateProvider(activeBackend.value, { 'apiKeys': apiKeys.value });
  void (async () => {
    let greeting = STATIC_GREETINGS[Date.now() % STATIC_GREETINGS.length] as string;
    try {
      const generated = await llm.suggestGreeting();
      if (generated.length > 0) greeting = generated;
    } catch { /* use static fallback */ }

    if (isFreshSession()) {
      conversation.value = [{ 'role': 'archivist', 'text': greeting, 'ts': Date.now() }];
    }

    if (isFreshSession() && visitorQuery.value.length === 0) {
      try {
        const reply = await llm.suggestVisitorReplyTo(greeting);
        if (reply.length > 0 && isFreshSession() && visitorQuery.value.length === 0) {
          visitorQuery.value = reply;
        }
      } catch {
        visitorQuery.value = STATIC_VISITOR_REPLIES[Date.now() % STATIC_VISITOR_REPLIES.length] as string;
      }
    }
  })();
}
</script>

<template>
  <div :class="['archivist-runner', { 'is-running': isRunning }]">

    <!-- Mobile banner — shown when device is detected as mobile.
         Three states:
           stub active (no keys set): canned-responses notice.
           cloud backend active (key set): concise cloud-backend notice.
           desktop override set: banner is not rendered (isMobile === false). -->
    <div v-if="isMobile && !noModel" class="mobile-banner" role="note">
      <span class="mobile-banner-text">
        <template v-if="activeBackend === 'stub'">
          Mobile mode — running with canned responses (not real AI). Add an API key below for real model output.
        </template>
        <template v-else>
          Mobile mode — using cloud backend {{ backends.find(b => b.id === activeBackend)?.displayName ?? activeBackend }}.
        </template>
      </span>
      <button type="button" class="mobile-banner-link" @click="onTreatAsDesktop">Treat as desktop</button>
    </div>

    <!-- No-model gate — shown before a backend is available.
         On mobile this block is unreachable: hasNoRunnableModel returns false
         because stub is the guaranteed fallback. Desktop path: no keys + no
         Nano + no WebLLM still triggers this gate. -->
    <section v-if="noModel" class="no-model-gate" role="alert">
      <h3>No LLM backend detected</h3>

      <template v-if="isMobile">
        <p>The Archivist demo runs against real cloud LLMs. On mobile, the fastest option is a free Groq key — no download, no GPU required.</p>
        <ul>
          <li>
            <strong>Groq (fastest)</strong> — paste a free key from
            <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">console.groq.com/keys</a>.
            Runs llama-3.3-70b-versatile. ~30 requests/min on the free tier.
          </li>
          <li>
            <strong>Cerebras</strong> — free key at
            <a href="https://cloud.cerebras.ai/?utm=arch" target="_blank" rel="noreferrer">cloud.cerebras.ai</a>.
            Ultra-fast Wafer-Scale Engine inference.
          </li>
          <li>
            <strong>Mistral</strong> — free key at
            <a href="https://console.mistral.ai/api-keys/" target="_blank" rel="noreferrer">console.mistral.ai/api-keys/</a>.
            mistral-small-latest.
          </li>
          <li>
            <strong>OpenRouter</strong> — free key at
            <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">openrouter.ai/keys</a>.
            Routes to llama-3.3-70b-instruct:free with no credits needed.
          </li>
        </ul>
      </template>
      <template v-else>
        <p>The Archivist demo runs against real on-device or web LLMs only — there is no canned fallback in the browser. To watch the DAG execute, enable one of:</p>
        <ul>
          <li><strong>Gemini Nano (Chrome on-device)</strong> — toggle <code>chrome://flags/#prompt-api-for-gemini-nano</code> and <code>chrome://flags/#optimization-guide-on-device-model</code>, restart, then visit <code>chrome://components</code> to trigger the model download.</li>
          <li><strong>Gemini API key</strong> — paste a free <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">AI Studio key</a> below; nothing leaves your browser except the request to Google.</li>
          <li><strong>WebLLM</strong> — needs WebGPU. Use a recent Chrome / Edge / Brave with hardware acceleration on.</li>
          <li><strong>Groq</strong> — free key at <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">console.groq.com/keys</a>. No GPU required.</li>
          <li><strong>Cerebras</strong> — free key at <a href="https://cloud.cerebras.ai/?utm=arch" target="_blank" rel="noreferrer">cloud.cerebras.ai</a>.</li>
          <li><strong>Mistral</strong> — free key at <a href="https://console.mistral.ai/api-keys/" target="_blank" rel="noreferrer">console.mistral.ai/api-keys/</a>.</li>
          <li><strong>OpenRouter</strong> — free key at <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">openrouter.ai/keys</a>.</li>
        </ul>
      </template>

      <BackendPicker
        :backends="backends"
        :active-id="activeBackend"
        :api-keys="apiKeys"
        :is-mobile="isMobile"
        :disabled="true"
        @update:active-id="activeBackend = $event as ProviderId"
        @update:api-keys="apiKeys = $event"
      />
    </section>

    <!-- Main layout — two-column grid, container-query driven -->
    <template v-else>
      <div class="ar-grid">

        <!-- LEFT: Conversation | Config -->
        <div class="ar-col ar-col--left">
          <div class="ar-col-head">
            <span class="ar-label">Archivist</span>
            <span class="ar-hint">{{ isRunning ? 'running…' : 'ready' }}</span>
          </div>
          <PanesTabs :tabs="leftTabs" default-key="conversation" class="ar-tabs">
            <!-- Conversation tab: the visual-first surface -->
            <template #conversation>
              <div class="ar-left-pane">
                <Conversation :turns="conversation" />
                <SendForm
                  :query="visitorQuery"
                  :running="isRunning"
                  :terminal-kind="terminalKind"
                  @update:query="visitorQuery = $event"
                  @ask="ask"
                  @cancel="cancel"
                  @reset="reset"
                />
              </div>
            </template>

            <!-- Config tab: backend + persistence + timeouts + checkpoints -->
            <template #config>
              <div class="ar-config-pane">
                <section class="ar-config-section">
                  <h5 class="ar-config-head">Backend</h5>
                  <BackendPicker
                    :backends="backends"
                    :active-id="activeBackend"
                    :api-keys="apiKeys"
                    :is-mobile="isMobile"
                    :disabled="isRunning"
                    @update:active-id="activeBackend = $event as ProviderId"
                    @update:api-keys="apiKeys = $event"
                  />
                </section>

                <section class="ar-config-section">
                  <h5 class="ar-config-head">Checkpoints</h5>
                  <CheckpointControls
                    :checkpoint-node="checkpointNode"
                    :running="isRunning"
                    :has-checkpoint="hasCheckpoint"
                    @save="saveCheckpoint"
                    @resume="resumeFromCheckpoint"
                  />
                </section>

                <section class="ar-config-section">
                  <TimeoutPane @update:settings="onTimeoutSettingsUpdate" />
                </section>
              </div>
            </template>
          </PanesTabs>
        </div>

        <!-- RIGHT: DAG | Memory | Trace -->
        <div class="ar-col ar-col--right">
          <div class="ar-col-head">
            <span class="ar-label">Graph</span>
            <span class="ar-hint">{{ memoryStore.size }} triples</span>
          </div>
          <PanesTabs :tabs="rightTabs" default-key="dag" class="ar-tabs ar-tabs--right">
            <template #tab-suffix>
              <button
                :class="['persist-toggle', isPersisted ? 'persist-toggle--on' : 'persist-toggle--off']"
                :title="isPersisted ? 'Persisted to localStorage — click to switch to in-memory' : 'In-memory only — click to enable localStorage persistence'"
                @click="togglePersistence"
              >{{ isPersisted ? '⎓ persisted' : '○ in-memory' }}</button>
            </template>

            <!-- DAG tab: live execution graph -->
            <template #dag>
              <div class="graph-pane">
                <DagGraph
                  ref="dagGraph"
                  :elements="dagElements"
                  aria-label="Archivist DAG live execution"
                  @node-click="onToolSelect"
                />
                <ToolExplainPanel
                  :selected-tool="selectedTool"
                  :llm="currentLlm"
                  :tool-context-map="toolContextMap"
                  @close="selectedTool = null"
                />
              </div>
            </template>

            <!-- Memory tab: cosmos.gl RDF graph -->
            <template #memory>
              <div class="graph-pane">
                <MemoryGraph
                  :store="memoryStore"
                  :tick="memoryTick"
                  @clear="clearMemory"
                  @select="onMemorySelect"
                />
                <TripleInspector
                  :store="memoryStore"
                  :tick="memoryTick"
                  :selection="selectedSelection"
                  @close="selectedSelection = null"
                />
              </div>
            </template>

            <!-- Trace tab: merged node lifecycle + logger feed -->
            <template #trace>
              <TraceFeed :entries="trace" :logger="logger" @node-click="onToolSelect" />
            </template>
          </PanesTabs>
        </div>

      </div>
    </template>
  </div>
</template>

<style scoped>
/* ── Container ─────────────────────────────────────────────────────────── */
.archivist-runner {
  container-type: inline-size;
  container-name: archivist;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 1rem;
  background: var(--vp-c-bg-alt);
  font-family: var(--vp-font-family-base);
  width: 100%;
}

/* ── Mobile banner ─────────────────────────────────────────────────────── */
.mobile-banner {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.6rem 1rem;
  margin-bottom: 0.85rem;
  padding: 0.6rem 0.85rem;
  background: rgba(99, 179, 237, 0.1);
  border: 1px solid rgba(99, 179, 237, 0.35);
  border-radius: 6px;
  font-size: 0.83rem;
  line-height: 1.45;
  color: var(--vp-c-text-1);
}

.mobile-banner-text {
  flex: 1 1 200px;
}

.mobile-banner-link {
  flex-shrink: 0;
  background: transparent;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  padding: 0.22rem 0.55rem;
  font-size: 0.78rem;
  cursor: pointer;
  color: var(--vp-c-text-2);
  white-space: nowrap;
  transition: border-color 0.12s ease, color 0.12s ease;
}

.mobile-banner-link:hover {
  border-color: var(--dagonizer-brand);
  color: var(--dagonizer-brand);
}

/* ── No-model gate ─────────────────────────────────────────────────────── */
.no-model-gate {
  border: 1px dashed var(--dagonizer-brand3);
  border-radius: 6px;
  padding: 1.2rem 1.4rem;
  background: rgba(212, 166, 73, 0.08);
}

.no-model-gate h3 {
  margin: 0 0 0.6rem 0;
  color: var(--dagonizer-brand3);
  font-size: 1.05rem;
  letter-spacing: 0.04em;
}

.no-model-gate p {
  margin: 0 0 0.7rem 0;
  color: var(--vp-c-text-1);
  font-size: 0.92rem;
  line-height: 1.5;
}

.no-model-gate ul {
  margin: 0 0 1rem 0;
  padding-left: 1.4rem;
  color: var(--vp-c-text-1);
  font-size: 0.88rem;
  line-height: 1.55;
}

.no-model-gate li { margin-bottom: 0.4rem; }
.no-model-gate code {
  background: var(--vp-c-bg-elv);
  padding: 0.1rem 0.35rem;
  border-radius: 3px;
  font-family: var(--vp-font-family-mono);
  font-size: 0.82rem;
}

/* ── Two-column grid — iridis pattern ──────────────────────────────────── */
.ar-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.25rem;
}

@container archivist (min-width: 720px) {
  .ar-grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.55fr);
  }
}

/* ── Column ────────────────────────────────────────────────────────────── */
.ar-col {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}

/* ── Column head (iridis pattern) ──────────────────────────────────────── */
.ar-col-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  min-height: 1.75rem;
}

.ar-label {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
}

.ar-hint {
  font-size: 0.7rem;
  color: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
}

/* ── Tab panels ────────────────────────────────────────────────────────── */
.ar-tabs {
  flex: 1 1 auto;
  min-height: 520px;
  max-height: min(860px, calc(100vh - 200px));
  overflow: hidden;
}

.ar-tabs--right {
  min-height: 520px;
  max-height: min(860px, calc(100vh - 200px));
}

/* ── Conversation tab pane ─────────────────────────────────────────────── */
.ar-left-pane {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  height: 100%;
  padding: 0.75rem;
}

/* ── Config tab pane ───────────────────────────────────────────────────── */
.ar-config-pane {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  padding: 0.85rem 0.9rem;
  overflow-y: auto;
  height: 100%;
}

.ar-config-section {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.ar-config-head {
  margin: 0;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
}

/* ── Shared graph pane — identical dimensions for DAG and Memory tabs ──── */
.graph-pane {
  position: relative;
  width: 100%;
  height: 640px;
}

.archivist-runner.is-running .graph-pane {
  box-shadow: 0 0 0 1px var(--dagonizer-brand), 0 0 28px -6px var(--dagonizer-brand);
  animation: dag-pulse 1.8s ease-in-out infinite;
  border-radius: 8px;
}

@keyframes dag-pulse {
  0%, 100% { box-shadow: 0 0 0 1px var(--dagonizer-brand), 0 0 28px -8px var(--dagonizer-brand); }
  50%      { box-shadow: 0 0 0 1px var(--dagonizer-brand), 0 0 36px -2px var(--dagonizer-brand); }
}

/* ── Persistence toggle in tab-suffix ──────────────────────────────────── */
.persist-toggle {
  display: inline-flex;
  align-items: center;
  padding: 0.28rem 0.6rem;
  background: transparent;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  font-family: var(--vp-font-family-mono);
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}

.persist-toggle--on {
  color: var(--dagonizer-brand2);
  border-color: var(--dagonizer-brand2);
}

.persist-toggle--off {
  color: var(--vp-c-text-3);
}

.persist-toggle:hover {
  background: var(--vp-c-bg);
  border-color: var(--dagonizer-brand);
  color: var(--dagonizer-brand);
}
</style>
