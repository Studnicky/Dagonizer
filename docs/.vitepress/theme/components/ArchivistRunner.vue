<script setup lang="ts">
/**
 * ArchivistRunner: orchestrator for the in-browser Archivist demo.
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
 * cytoscape nodes / edges via the DagGraph's imperative surface; no
 * setTimeout, no polling, no JS-driven animation loops.
 */

import { computed, onMounted, ref, shallowRef, watch } from 'vue';

import { Checkpoint, CheckpointRestoreAdapter } from '@studnicky/dagonizer/checkpoint';
import type { ExecutionResultType } from '@studnicky/dagonizer';

import { ArchivistState } from '../../../../examples/the-archivist/ArchivistState.ts';
import { ArchivistBundleFactory } from '../../../../examples/the-archivist/dag.ts';
import { DomConsoleLogger } from '../../../../examples/the-archivist/logger/DomConsoleLogger.ts';
import type { LogEvent } from '../../../../examples/the-archivist/logger/ConsoleLogger.ts';
import { MemoryStore } from '../../../../examples/the-archivist/memory/MemoryStore.ts';
import { ONTOLOGY_NTRIPLES } from '../../../../examples/the-archivist/ontology/ArchivistOntology.ts';
import { SeedLibrary } from '../../../../examples/the-archivist/data/SeedLibrary.ts';
import { RdfProvObserver } from '../../../../examples/the-archivist/provenance/RdfProvObserver.ts';
import { StateProjection } from '../../../../examples/the-archivist/state/StateProjection.ts';
import { NODE_VARIANTS } from '../../../../examples/the-archivist/nodes/ArchivistNode.ts';
import { ArchivistNodes } from '../../../../examples/the-archivist/nodes/ArchivistNodes.ts';
import { ApiKeyStore, BackendMatrix, EmbedderProvisioner, OllamaModels, ProviderInstantiator } from '../../../../examples/the-archivist/providers/index.ts';
import { MobileDetection } from '../../../../examples/the-archivist/providers/MobileDetection.ts';
import type { BackendAvailability, ProviderId } from '../../../../examples/the-archivist/providers/index.ts';
import type { IntentClassifier } from '../../../../examples/the-archivist/providers/IntentClassifier.ts';
import type { EmbedderInterface } from '@studnicky/dagonizer/contracts';
import type { ArchivistServices } from '../../../../examples/the-archivist/services.ts';
import { ToolRegistry, ToolInvocationState } from '@studnicky/dagonizer/tool';
import { GoogleBooksTool } from '@studnicky/dagonizer-tool-googlebooks';
import { OpenLibrarySearchTool } from '@studnicky/dagonizer-tool-openlibrary';
import { SubjectSearchTool } from '@studnicky/dagonizer-tool-openlibrary';
import { WikipediaSummaryTool } from '@studnicky/dagonizer-tool-wikipedia';
import { BookSearchScatterBundleFactory } from '../../../../examples/the-archivist/embedded-dags/BookSearchScatterDAG.ts';
import { ComposeRetryLoopBundleFactory } from '../../../../examples/the-archivist/embedded-dags/ComposeRetryLoopDAG.ts';
import type { DAGType } from '@studnicky/dagonizer';

import { ObservedDag } from '../../../../examples/the-archivist/ObservedDag.ts';
import BackendPicker from './BackendPicker.vue';
import CheckpointControls from './CheckpointControls.vue';
import Conversation from './Conversation.vue';
import DagGraph from './DagGraph.vue';
import MemoryGraph from './MemoryGraph.vue';
import type { MemorySelection } from './MemoryGraph.vue';
import PanesTabs from './PanesTabs.vue';
import SendForm from './SendForm.vue';
import ConversationContextPane from './ConversationContextPane.vue';
import TimeoutPane from './TimeoutPane.vue';
import type { TimeoutSettings } from './TimeoutPane.vue';
import ToolExplainPanel from './ToolExplainPanel.vue';
import TraceFeed from './TraceFeed.vue';
import TripleInspector from './TripleInspector.vue';

import { RunnerMachine } from '../runner/RunnerMachine.ts';

// ── State ───────────────────────────────────────────────────────────────
const backends = ref<readonly BackendAvailability[]>([]);
// Prefer a saved override; fall back to the highest-priority reachable
// backend at mount time (resolved in onMounted once BackendMatrix.detect completes).
const savedBackend = typeof localStorage !== 'undefined'
  ? (localStorage.getItem('dagonizer-active-backend') as ProviderId | null)
  : null;
const activeBackend = ref<ProviderId | null>(savedBackend);
const noModel = ref(false);
const isMobile = ref(false);
const apiKeys = ref<Partial<Record<ProviderId, string>>>(ApiKeyStore.load());
const ollamaModel = ref<string>(OllamaModels.loadModel());

// Slow-backend banner: shown when the active backend is the browser
// built-in `LanguageModel` or WebLLM AND no cloud key is configured.
// Dismissable; preference persisted under `archivist:dismiss-slow-banner`.
const SLOW_BANNER_KEY = 'archivist:dismiss-slow-banner';
const slowBannerDismissed = ref<boolean>(
  typeof localStorage !== 'undefined' && localStorage.getItem(SLOW_BANNER_KEY) === '1',
);
const CLOUD_KEY_IDS: readonly ProviderId[] = ['gemini-api', 'anthropic', 'groq', 'cerebras', 'mistral', 'openrouter'];
const showSlowBanner = computed(() => {
  if (slowBannerDismissed.value) return false;
  if (activeBackend.value !== 'gemini-nano' && activeBackend.value !== 'web-llm') return false;
  const hasCloudKey = CLOUD_KEY_IDS.some((id) => {
    const k = apiKeys.value[id];
    return typeof k === 'string' && k.length > 0;
  });
  return !hasCloudKey;
});
function dismissSlowBanner(): void {
  slowBannerDismissed.value = true;
  if (typeof localStorage !== 'undefined') localStorage.setItem(SLOW_BANNER_KEY, '1');
}
const visitorQuery = ref('');
const isRunning = ref(false);
const conversation = ref<Array<{ role: 'visitor' | 'archivist'; text: string; ts: number }>>([]);
type TraceEvent =
  | { readonly variant: 'start'; readonly node: string; readonly ts: number }
  | { readonly variant: 'end';   readonly node: string; readonly ts: number; readonly output: string | null }
  | { readonly variant: 'error'; readonly node: string; readonly ts: number; readonly message: string }
  | { readonly variant: 'note';  readonly node: string; readonly ts: number; readonly message: string };

const trace = ref<TraceEvent[]>([]);
const terminalVariant = ref<'pending' | 'completed' | 'failed' | 'cancelled' | 'timed_out'>('pending');

// shallowRef holds opaque service instances by reference: deep reactivity is
// wrong for these, and it preserves IntentClassifier's nominal (private-field)
// type, which Vue's deep UnwrapRef would otherwise strip.
const embedder = shallowRef<EmbedderInterface | null>(null);
const intentClassifier = shallowRef<IntentClassifier | null>(null);

const dagGraph = ref<InstanceType<typeof DagGraph> | null>(null);
const memoryStore = new MemoryStore();
const memoryTick = ref(0); // bumped after each write so MemoryGraph re-renders
// Reactive event sink owned by Vue: DomConsoleLogger.onEmit appends here, so
// TraceFeed re-renders from `logEvents` without any subscribe callback.
const logEvents = ref<LogEvent[]>([]);
const logger = new DomConsoleLogger({ 'events': logEvents.value });

// `memoryStore` is a plain class, not a reactive object, so a bare
// `memoryStore.size` read in the template never re-evaluates on its own. Route
// every count display through this computed so it tracks `memoryTick` (bumped
// after every store mutation, including clear) and refreshes in lockstep.
const tripleCount = computed(() => {
  void memoryTick.value;
  return memoryStore.size;
});

// ── Conversation context window ───────────────────────────────────────────
const conversationContextWindow = ref(6);

function onConversationWindowUpdate(size: number): void {
  conversationContextWindow.value = size;
}

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
 * grace window. Per-node timeouts are the primary mechanism; this is a
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
let lastResult: ExecutionResultType<ArchivistState> | null = null;
let lastDagName = 'the-archivist';

async function saveCheckpoint(): Promise<void> {
  if (lastResult === null || lastResult.cursor === null) {
    logger.warn('no resumable checkpoint available (run completed fully, or no run yet)');
    return;
  }
  try {
    const ckpt = await Checkpoint.capture(lastDagName, lastResult, { 'stores': { 'memory': memoryStore } });
    localStorage.setItem(CHECKPOINT_KEY, ckpt.toJson());
    checkpointNode.value = lastResult.cursor;
    hasCheckpoint.value = true;
    dagGraph.value?.setCompleted(lastResult.cursor);
    trace.value = [...trace.value, {
      'node': lastResult.cursor,
      'ts': Date.now(),
      'variant': 'end',
      'output': 'checkpoint saved',
    }];
    logger.info(`checkpoint saved at ${lastResult.cursor}`);
  } catch (err) {
    logger.warn(`checkpoint failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function resumeFromCheckpoint(): Promise<void> {
  if (isRunning.value || activeBackend.value === null) return;
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
    const ckpt = Checkpoint.load(parsed);
    await ckpt.restoreStores({ 'memory': memoryStore });
    restored = ckpt.restoreState(
      CheckpointRestoreAdapter.wrap((snap) => ArchivistState.restore(snap)),
    );
  } catch (err) {
    logger.warn(`checkpoint restore failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  runnerMachine.dispatch({ 'type': 'submit' });
  isRunning.value = true;
  terminalVariant.value = 'pending';
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

  let dispatcher: ArchivistBrowserObserver | null = null;

  try {
    const services = buildServices();
    const nodes = ArchivistNodes.build(services);
    const bookSearchBundle = BookSearchScatterBundleFactory.create(nodes);
    const composeBundle    = ComposeRetryLoopBundleFactory.create(nodes);
    const parentBundle     = ArchivistBundleFactory.create(nodes);

    const parentDag = parentBundle.dags[0];
    if (parentDag !== undefined) archivistDag.value = parentDag;
    const bookSearchDag = bookSearchBundle.dags[0];
    const composeRetryDag = composeBundle.dags[0];
    if (bookSearchDag !== undefined && composeRetryDag !== undefined) {
      embeddedDagRegistry.value = new Map([
        ['book-search-scatter', bookSearchDag],
        ['compose-retry-loop', composeRetryDag],
      ]);
    }

    dispatcher = new ArchivistBrowserObserver(logger, { 'fromCursor': restored.cursor, 'prov': prov });

    dispatcher.registerBundle(archivistToolRegistry.bundle());
    dispatcher.registerBundle(bookSearchBundle);
    dispatcher.registerBundle(composeBundle);
    dispatcher.registerBundle(parentBundle);

    activeAbortController = new AbortController();
    const deadlineMs = overallDeadlineMs();

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
    await dispatcher?.destroy();
    activeAbortController = null;
    isRunning.value = false;
  }
}

// UI state machine: runner subscribes; views derive UI from the
// machine's current state instead of independent refs.
const runnerMachine = new RunnerMachine();

// Selected node in the memory graph; TripleInspector reads this.
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
  'subject-scout':       'OpenLibrary subjects search: finds books by theme/topic, not title.',
  'wikipedia-scout':     'Wikipedia page summary: enrichment context for any topic or book.',
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
  'has-citations-gate':  'Deterministic gate: checks whether the shortlist has at least one citation before composing.',
  'decline-off-topic':   'Emits a polite in-character refusal for questions outside the book domain.',
  'decline-empty':       'Emits an in-character acknowledgment when all scouts returned no candidates.',
  'compose-empty-response': 'LLM composes a graceful not-found response that names what was searched and suggests an alternative.',
  'extract-query':       'Deterministic node: copies the visitor query into state for the scout phase.',
  'group-by-year':       'Groups candidates by first-publish year for chronological author-survey display.',
  'pick-best-match':     'Deterministic node: picks the highest-scored candidate from the ranked list.',
  'rank-by-rating':      'Sorts candidates by Google Books rating signal (rating × log(ratingsCount)) for the find-reviews branch.',
  'respond-to-visitor':  'Routes the composed draft into the conversation output and marks the lifecycle as completed.',
};

/**
 * The model to instantiate the active backend's adapter with. For ollama, the
 * visitor's explicit choice takes priority (if set); for all other backends the
 * detector-resolved model is used directly. An empty string means "no explicit
 * override": the adapter falls back to its internal default.
 */
const resolvedModel = computed<string>(() => {
  if (activeBackend.value === 'ollama' && ollamaModel.value.length > 0) return ollamaModel.value;
  const entry = backends.value.find((b) => b.id === activeBackend.value);
  return entry?.resolvedModel ?? '';
});

/** Construct an LLM client for the active backend, or null when none is selected. */
function makeLlm() {
  if (activeBackend.value === null) return null;
  return ProviderInstantiator.instantiate(activeBackend.value, {
    'apiKeys': apiKeys.value,
    'model':   resolvedModel.value,
    ...(intentClassifier.value !== null ? { 'intentClassifier': intentClassifier.value } : {}),
  });
}

/** Live LLM client reference, kept in sync with activeBackend changes. */
const currentLlm = computed(() => makeLlm());

function clearMemory(): void {
  // Drop the accumulated memory facts but keep the schema: re-insert the TBox
  // ontology so the graph re-renders with its structure rather than going fully
  // empty. The seed library (run/book facts) is intentionally not restored —
  // that is what "clear" removes; use "Reset conversation" to reseed books.
  memoryStore.clear();
  memoryStore.loadOntology(ONTOLOGY_NTRIPLES);
  memoryTick.value++;
  logger.info('memory store cleared; ontology restored');
}

// Re-detect backend availability when apiKeys change.
watch(apiKeys, async () => {
  backends.value = await BackendMatrix.detect({ 'apiKeys': apiKeys.value, ...(ollamaModel.value.length > 0 ? { 'preferredOllamaModel': ollamaModel.value } : {}) });
  noModel.value = BackendMatrix.hasNoRunnableModel(backends.value, { 'isMobile': isMobile.value });
}, { 'deep': true });

// Persist the visitor's backend selection so it survives page reloads.
watch(activeBackend, (id) => {
  if (typeof localStorage !== 'undefined' && id !== null) {
    localStorage.setItem('dagonizer-active-backend', id);
  }
});

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
    { 'key': 'memory', 'label': 'Memory', 'badge': String(tripleCount.value || ''), 'tone': 'accent' as const },
    { 'key': 'trace',  'label': 'Trace',  'badge': String(traceCount || ''),        'tone': (isRunning.value ? 'live' : 'default') as 'live' | 'default' },
  ];
});

// Lazily-populated top-level archivist DAG reference for DagGraph display.
// Set on the first call to buildRunBundles() (ask() or resumeFromCheckpoint()),
// so the graph renders the DAG structure once a real LLM/services set exists.
const archivistDag = ref<DAGType | null>(null);

// Lazily-populated embedded-DAG registry. Keys match the embeddedDAG placement
// names in the parent DAG. Built alongside archivistDag from the same factory call.
const embeddedDagRegistry = ref<Map<string, DAGType>>(new Map());

// Stable tool instances. The scout nodes call `tool.execute(...)`, which is an
// instance method on each Tool class (`new OpenLibrarySearchTool()`), so the
// services must carry instances, not the class constructors. One instance each,
// reused across every run — the HTTP tools are stateless.
const webSearchTool        = new OpenLibrarySearchTool();
const googleBooksTool      = new GoogleBooksTool();
const subjectSearchTool    = new SubjectSearchTool();
const wikipediaSummaryTool = new WikipediaSummaryTool();

// Tool registry: each tool becomes an embeddable `tool:<name>` DAG that the
// book-search scatter resolves at runtime via `{ dagFrom: 'dagName' }`. Must be
// registered (before bookSearchScatterBundle) or every scatter item fails to
// resolve its body DAG and routes to 'error' — parity with the CLI (main.ts).
const archivistToolRegistry = new ToolRegistry();
archivistToolRegistry.register(webSearchTool);
archivistToolRegistry.register(googleBooksTool);
archivistToolRegistry.register(subjectSearchTool);
archivistToolRegistry.register(wikipediaSummaryTool);

function buildServices(): ArchivistServices {
  const llm = makeLlm();
  if (llm === null) throw new Error('no backend selected');
  return {
    'webSearch':         webSearchTool,
    'googleBooks':       googleBooksTool,
    'subjectSearch':     subjectSearchTool,
    'wikipediaSummary':  wikipediaSummaryTool,
    'memory':            memoryStore,
    'llm':               llm,
    // Browser embedder provisioned when available (transformers → tensorflow →
    // web-llm). Cosine recall and hybrid ranking fall back to Jaccard /
    // heuristics when no embedder is reachable.
    'embedder':          embedder.value,
    'nodeTimeouts':      {},
  };
}

/**
 * Dispatch map: after key nodes complete, log what the search pipeline did.
 * Lives here (not in ObservedDag) because it reads ArchivistState-specific fields.
 */
const ARCHIVIST_NODE_TRACE: Readonly<Record<string, (state: ArchivistState, log: DomConsoleLogger) => void>> = {
  'extract-query': (state, log) => {
    log.info(`terms: [${state.terms.join(', ')}]`);
  },
  'build-book-worksets': (state, log) => {
    for (const ws of state.bookWorksets) {
      const a = ws.arguments;
      const q = a['query'] ?? a['isbn'] ?? a['author'] ?? a['subject'] ?? '?';
      log.info(`search: ${ws.dagName.replace('tool:', '')} → "${String(q)}"`);
    }
    if (state.bookWorksets.length === 0) {
      log.warn('search: no worksets built — no tools will run');
    }
  },
  'rank-candidates': (state, log) => {
    log.info(`candidates from tools: ${state.candidates.length}`);
  },
  'merge-candidates': (state, log) => {
    log.info(`shortlist: ${state.shortlist.length} · prior-memory: ${state.priorCandidates.length}`);
  },
};

/**
 * Browser-specific Archivist observer. Extends ObservedDag and drives the Vue
 * reactive state directly: structured trace entries, DAG graph animation,
 * provenance recording, and runner machine pulses.
 *
 * Structured trace rows are emitted only for top-level pipeline nodes
 * (placementPath.length === 0). Inner scatter/tool-clone nodes update
 * the cytoscape graph and prov store without adding trace rows, keeping
 * the feed readable as a clean lifecycle timeline.
 *
 * Tolerated inner tool-clone failures (output === 'error' on a ToolInvocationState)
 * produce a muted 'note' trace entry rather than a red 'error' row.
 *
 * Constructed once per run inside `ask()` / `resumeFromCheckpoint()`.
 */
class ArchivistBrowserObserver extends ObservedDag<ArchivistState> {
  readonly #domLogger: DomConsoleLogger;
  readonly #fromCursor: string | null;
  readonly #prov: RdfProvObserver;
  #shownErrorCount = 0;

  constructor(
    log: DomConsoleLogger,
    options: { readonly fromCursor: string | null; readonly prov: RdfProvObserver },
  ) {
    super(log);
    this.#domLogger = log;
    this.#fromCursor = options.fromCursor;
    this.#prov = options.prov;
  }

  protected override onFlowStart(dagName: string): void {
    if (this.#fromCursor !== null) dagGraph.value?.setActive(this.#fromCursor);
    this.#prov.recordFlowStart(dagName);
  }

  protected override onNodeStart(
    nodeName: string,
    state: ArchivistState,
    placementPath: readonly string[],
  ): void {
    // `placementPath` is the ordered list of parent embedded-DAG placement names.
    // Join with the node name to form the cytoscape id used by `DagGraph`; this
    // disambiguates same-named inner placements so only the executing one lights up.
    const fullId = [...placementPath, nodeName].join('/');
    // Trace rows are emitted only for top-level nodes; inner nodes update the
    // graph and prov store without contributing feed rows.
    if (placementPath.length === 0) {
      trace.value = [...trace.value, { 'node': fullId, 'ts': Date.now(), 'variant': 'start' }];
    }
    dagGraph.value?.setActive(fullId);
    this.#prov.recordNodeStart(nodeName);
    runnerMachine.pulse({ 'type': 'nodeStart', 'node': nodeName });
  }

  protected override onNodeEnd(
    nodeName: string,
    output: string | null,
    state: ArchivistState,
    placementPath: readonly string[],
  ): void {
    const fullId = [...placementPath, nodeName].join('/');
    const isInner = placementPath.length > 0;

    if (isInner) {
      // Inner tool-clone nodes: update graph + prov without adding start/end
      // trace rows. A failed clone (output === 'error' on a ToolInvocationState)
      // emits a single muted 'note' row classifying the tolerated failure.
      if (output === 'error' && state instanceof ToolInvocationState) {
        const lastErr = state.errors[state.errors.length - 1];
        const rawName = lastErr !== undefined
          ? (lastErr.context['toolName'])
          : undefined;
        const toolName = typeof rawName === 'string' && rawName.length > 0
          ? rawName
          : (placementPath[placementPath.length - 1] ?? nodeName);
        const errMsg = lastErr !== undefined ? lastErr.message : '';
        const isRateLimit = /429|too many requests/i.test(errMsg);
        const noteMsg = isRateLimit
          ? `${toolName} · rate-limited · skipped`
          : `${toolName} · unavailable · skipped`;
        trace.value = [...trace.value, {
          'node': toolName,
          'ts': Date.now(),
          'variant': 'note',
          'message': noteMsg,
        }];
      }
    } else {
      // Top-level nodes emit structured start/end trace rows.
      trace.value = [...trace.value, { 'node': fullId, output, 'ts': Date.now(), 'variant': 'end' }];
    }

    dagGraph.value?.setCompleted(fullId);
    if (output !== null) dagGraph.value?.markEdgeTraversed(fullId, output);
    // The parent observer fires for nodes inside isolated child states
    // (e.g. the tool:<name> scatter bodies) whose state is NOT an
    // ArchivistState — only project the parent's ArchivistState into memory.
    if (state instanceof ArchivistState) {
      StateProjection.project(state, memoryStore);
      // Surface any errors the parent state collected since the last node end
      // (routed-to-'error' failures collect without throwing onError).
      for (let i = this.#shownErrorCount; i < state.errors.length; i++) {
        const err = state.errors[i];
        if (err === undefined) continue;
        // Tolerated tool-clone failures (rate limits, unreachable APIs) are
        // already surfaced as muted 'note' rows from the inner-node path, and
        // the any-success scatter absorbs them — they are not pipeline errors.
        // Skip them here so the same failure does not also render as an
        // alarming 'error' row.
        if (err.code === 'toolExecutionFailed') continue;
        trace.value = [...trace.value, {
          'node': err.operation !== '' ? err.operation : fullId,
          'ts': Date.now(),
          'variant': 'error',
          'message': `${err.code}: ${err.message}`,
        }];
      }
      this.#shownErrorCount = state.errors.length;
      ARCHIVIST_NODE_TRACE[nodeName]?.(state, this.#domLogger);
    }
    this.#prov.recordNodeEnd(nodeName, output ?? undefined);
    memoryTick.value++;
    runnerMachine.pulse(output === null
      ? { 'type': 'nodeEnd', 'node': nodeName }
      : { 'type': 'nodeEnd', 'node': nodeName, 'output': output });
  }

  protected override onError(
    nodeName: string,
    error: Error,
    state: ArchivistState,
    placementPath: readonly string[],
  ): void {
    const fullId = [...placementPath, nodeName].join('/');
    // Only top-level (placementPath empty) errors become red 'error' trace rows.
    // Inner tool-clone failures are already handled as muted 'note' rows in onNodeEnd.
    if (placementPath.length === 0) {
      trace.value = [...trace.value, { 'node': fullId, 'ts': Date.now(), 'variant': 'error', 'message': error.message !== '' ? error.message : String(error) }];
    }
    dagGraph.value?.setErrored(fullId);
    this.#prov.recordError(nodeName, error);
    runnerMachine.pulse({ 'type': 'nodeError', 'node': nodeName, 'error': error });
  }

  // Phase enter/exit are internal scheduling markers. The base ObservedDag
  // logs them as `[dag:phase] …` trace lines; suppress that raw framework
  // noise so the feed reads as a clean node lifecycle (no super call).
  protected override onPhaseEnter(dagName: string, phase: 'pre' | 'post', placementName: string): void {
    void dagName; void phase; void placementName;
  }

  protected override onPhaseExit(dagName: string, phase: 'pre' | 'post', placementName: string): void {
    void dagName; void phase; void placementName;
  }

  protected override onFlowEnd(
    dagName: string,
    state: ArchivistState,
    result: ExecutionResultType<ArchivistState>,
  ): void {
    const lifecycleVariant = state.lifecycle.variant;
    if (lifecycleVariant === 'completed' || lifecycleVariant === 'failed' || lifecycleVariant === 'cancelled' || lifecycleVariant === 'timed_out') {
      terminalVariant.value = lifecycleVariant;
    }
    if (state.draft.length > 0) {
      conversation.value = [...conversation.value, {
        'role': 'archivist',
        'text': state.draft,
        'ts': Date.now(),
      }];
    }
    lastResult = result;
    lastDagName = dagName;
    if (result.cursor !== null) checkpointNode.value = result.cursor;
    this.#prov.recordFlowEnd(lifecycleVariant);
    memoryTick.value++;
    this.#domLogger.result(`intent=${state.intent} · shortlist=${String(state.shortlist.length)} · triples=${String(memoryStore.size)} · lifecycle=${lifecycleVariant}`);
    runnerMachine.dispatch({ 'type': 'flowEnd', 'lifecycle': lifecycleVariant });
  }
}

// ── Static fallback pools ────────────────────────────────────────────────
const STATIC_GREETINGS: readonly string[] = [
  'Welcome to the shop. The shelves remember everything they hold. What brings you in?',
  'Stay a while. I have a long list of books and a longer one of questions about them.',
  'A reader, then. Tell me what you are looking for, and I will see what the catalog gives up.',
  'The door is always open here. Name a title, an author, or a feeling, and I will look.',
  'Good to see you. The shelves run deep on every subject. Where would you like to begin?',
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
  // A fresh session has at most one entry: the archivist greeting (or nothing yet).
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
  SeedLibrary.loadInto(memoryStore);
  memoryTick.value++;

  isMobile.value = MobileDetection.isLikelyMobile();

  backends.value = await BackendMatrix.detect({ 'apiKeys': apiKeys.value, ...(ollamaModel.value.length > 0 ? { 'preferredOllamaModel': ollamaModel.value } : {}) });

  // Kick off embedder provisioning without blocking auto-seed; the classifier
  // becomes available when the model download completes and updates refs so
  // makeLlm() picks it up on subsequent turns.
  void EmbedderProvisioner.provision().then((r) => {
    embedder.value = r.embedder;
    intentClassifier.value = r.intentClassifier;
  });

  // Show the no-model gate when no real backend is available on this device.
  if (BackendMatrix.hasNoRunnableModel(backends.value, { 'isMobile': isMobile.value })) {
    noModel.value = true;
    logger.warn('no LLM backend detected; visitor must enable one');
    return;
  }
  noModel.value = false;

  // Honor a saved user preference only when that backend is runnable right now;
  // otherwise default to the best available backend (in-browser web models first).
  const savedEntry = savedBackend !== null
    ? backends.value.find((b) => b.id === savedBackend) ?? null
    : null;
  if (savedEntry !== null && savedEntry.runnable) {
    logger.info(`backend from saved preference: ${savedBackend}`);
  } else {
    const picked = BackendMatrix.pickBest(backends.value, { 'isMobile': isMobile.value });
    if (picked !== null) {
      activeBackend.value = picked.id;
      logger.info(
        savedBackend === null
          ? `backend auto-selected: ${picked.displayName}`
          : `saved preference "${savedBackend}" unavailable; defaulting to ${picked.displayName}`,
      );
    }
  }

  // On a fresh session: generate the Archivist greeting, push it to the
  // conversation, then generate a contextual visitor reply and pre-fill
  // the input. Only runs once per session; once the visitor sends a
  // message the input is cleared (via ask()) and this condition no longer fires.
  if (isFreshSession() && visitorQuery.value.length === 0) {
    const llm = makeLlm();

    // Step 1: generate greeting.
    let greeting = STATIC_GREETINGS[Date.now() % STATIC_GREETINGS.length] as string;
    if (llm !== null) {
      try {
        const generated = await llm.suggestGreeting();
        if (generated.length > 0) greeting = generated;
      } catch { /* use static fallback */ }
    }

    if (isFreshSession()) {
      conversation.value = [{ 'role': 'archivist', 'text': greeting, 'ts': Date.now() }];
    }

    // Step 2: generate a visitor reply keyed to the greeting.
    if (isFreshSession() && visitorQuery.value.length === 0) {
      if (llm !== null) {
        try {
          const reply = await llm.suggestVisitorReplyTo(greeting);
          if (reply.length > 0 && isFreshSession() && visitorQuery.value.length === 0) {
            visitorQuery.value = reply;
          }
        } catch {
          visitorQuery.value = STATIC_VISITOR_REPLIES[Date.now() % STATIC_VISITOR_REPLIES.length] as string;
        }
      } else {
        visitorQuery.value = STATIC_VISITOR_REPLIES[Date.now() % STATIC_VISITOR_REPLIES.length] as string;
      }
    }
  }
});

watch(apiKeys, () => { ApiKeyStore.save(apiKeys.value); }, { 'deep': true });
watch(ollamaModel, (next) => { OllamaModels.saveModel(next); });

// ── Run ──────────────────────────────────────────────────────────────────
async function ask(): Promise<void> {
  if (isRunning.value || visitorQuery.value.trim().length === 0 || activeBackend.value === null) return;
  runnerMachine.dispatch({ 'type': 'submit' });
  isRunning.value = true;
  terminalVariant.value = 'pending';
  trace.value = [];

  const queryText = visitorQuery.value;
  conversation.value = [...conversation.value, {
    'role': 'visitor',
    'text': queryText,
    'ts': Date.now(),
  }];
  // Clear the input immediately after capturing (the send-and-clear pattern).
  visitorQuery.value = '';

  await dagGraph.value?.reset();
  memoryTick.value++;
  logger.clear();
  logger.info(`run start, query: "${queryText}"`);

  const runId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `r-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;
  StateProjection.clear(runId, memoryStore);
  const prov = new RdfProvObserver({
    'store':              memoryStore,
    'runId':              runId,
    'dispatcherAgentId':  `dispatcher:${activeBackend.value}`,
  });

  const { composeMs, webSearchMs, rankMs } = timeoutSettings.value;
  const resolvedLlm = makeLlm();
  if (resolvedLlm === null) throw new Error('no backend selected');
  const services: ArchivistServices = {
    'webSearch':         webSearchTool,
    'googleBooks':       googleBooksTool,
    'subjectSearch':     subjectSearchTool,
    'wikipediaSummary':  wikipediaSummaryTool,
    'memory':            memoryStore,
    'llm':               resolvedLlm,
    'embedder':          embedder.value,
    'nodeTimeouts': {
      'compose-response':        composeMs,
      'compose-empty':           composeMs,
      'compose-memory-response': composeMs,
      'rank-candidates':         rankMs,
      'open-library-scout':      webSearchMs,
      'google-books-scout':      webSearchMs,
      'subject-scout':           webSearchMs,
      'wikipedia-scout':         webSearchMs,
    },
  };
  let dispatcher: ArchivistBrowserObserver | null = null;

  try {
    const nodes = ArchivistNodes.build(services);
    const bookSearchBundle = BookSearchScatterBundleFactory.create(nodes);
    const composeBundle    = ComposeRetryLoopBundleFactory.create(nodes);
    const parentBundle     = ArchivistBundleFactory.create(nodes);

    const parentDag = parentBundle.dags[0];
    if (parentDag !== undefined) archivistDag.value = parentDag;
    const bookSearchDag = bookSearchBundle.dags[0];
    const composeRetryDag = composeBundle.dags[0];
    if (bookSearchDag !== undefined && composeRetryDag !== undefined) {
      embeddedDagRegistry.value = new Map([
        ['book-search-scatter', bookSearchDag],
        ['compose-retry-loop', composeRetryDag],
      ]);
    }

    dispatcher = new ArchivistBrowserObserver(logger, { 'fromCursor': null, 'prov': prov });

    dispatcher.registerBundle(archivistToolRegistry.bundle());
    dispatcher.registerBundle(bookSearchBundle);
    dispatcher.registerBundle(composeBundle);
    dispatcher.registerBundle(parentBundle);

    const visitor = new ArchivistState();
    visitor.query = queryText;
    visitor.runId = runId;
    // Slice the display conversation to the configured window and assign to state
    // so every LLM prompt receives prior-turn context for pronoun resolution.
    const recentTurns = conversation.value.slice(-conversationContextWindow.value);
    visitor.conversation = recentTurns.map((t) => ({ 'role': t.role, 'text': t.text, 'ts': t.ts }));

    activeAbortController = new AbortController();
    const deadlineMs = overallDeadlineMs();

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
    await dispatcher?.destroy();
    activeAbortController = null;
    isRunning.value = false;
  }
}

function reset(): void {
  conversation.value = [];
  trace.value = [];
  terminalVariant.value = 'pending';
  selectedSelection.value = null;
  selectedTool.value = null;
  checkpointNode.value = null;
  lastResult = null;
  visitorQuery.value = '';
  // Fire-and-forget: the manual reset button is not starting a new run,
  // so no need to await; the fade plays visually but nothing depends on it.
  void dagGraph.value?.reset();
  memoryStore.clear();
  memoryStore.loadOntology(ONTOLOGY_NTRIPLES);
  SeedLibrary.loadInto(memoryStore);
  memoryTick.value++;
  logger.clear();
  runnerMachine.dispatch({ 'type': 'reset' });

  // Regenerate greeting + visitor reply after reset, same as onMounted.
  const llm = makeLlm();
  void (async () => {
    let greeting = STATIC_GREETINGS[Date.now() % STATIC_GREETINGS.length] as string;
    if (llm !== null) {
      try {
        const generated = await llm.suggestGreeting();
        if (generated.length > 0) greeting = generated;
      } catch { /* use static fallback */ }
    }

    if (isFreshSession()) {
      conversation.value = [{ 'role': 'archivist', 'text': greeting, 'ts': Date.now() }];
    }

    if (isFreshSession() && visitorQuery.value.length === 0) {
      if (llm !== null) {
        try {
          const reply = await llm.suggestVisitorReplyTo(greeting);
          if (reply.length > 0 && isFreshSession() && visitorQuery.value.length === 0) {
            visitorQuery.value = reply;
          }
        } catch {
          visitorQuery.value = STATIC_VISITOR_REPLIES[Date.now() % STATIC_VISITOR_REPLIES.length] as string;
        }
      } else {
        visitorQuery.value = STATIC_VISITOR_REPLIES[Date.now() % STATIC_VISITOR_REPLIES.length] as string;
      }
    }
  })();
}
</script>

<template>
  <div :class="['archivist-runner', { 'is-running': isRunning }]">

    <div v-if="isMobile && !noModel && activeBackend !== null" class="mobile-banner" role="note">
      <span class="mobile-banner-text">
        Mobile mode: using cloud backend {{ backends.find(b => b.id === activeBackend)?.displayName ?? activeBackend }}.
      </span>
      <button type="button" class="mobile-banner-link" @click="onTreatAsDesktop">Treat as desktop</button>
    </div>

    <!-- No-model gate: shown when no real backend is available on this device. -->
    <section v-if="noModel" class="no-model-gate" role="alert">
      <h3>No LLM backend detected</h3>

      <template v-if="isMobile">
        <p>The Archivist demo runs against real cloud LLMs. On mobile, the fastest option is a free Groq key: no download, no GPU required.</p>
        <ul>
          <li>
            <strong>Groq (fastest):</strong> paste a free key from
            <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">console.groq.com/keys</a>.
            ~30 requests/min on the free tier.
          </li>
          <li>
            <strong>Cerebras:</strong> free key at
            <a href="https://cloud.cerebras.ai/?utm=arch" target="_blank" rel="noreferrer">cloud.cerebras.ai</a>.
            Ultra-fast Wafer-Scale Engine inference.
          </li>
          <li>
            <strong>Mistral:</strong> free key at
            <a href="https://console.mistral.ai/api-keys/" target="_blank" rel="noreferrer">console.mistral.ai/api-keys/</a>.
          </li>
          <li>
            <strong>OpenRouter:</strong> free key at
            <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">openrouter.ai/keys</a>.
            Routes to free-tier models with no credits needed.
          </li>
          <li><strong>Anthropic:</strong> key at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>.</li>
        </ul>
      </template>
      <template v-else>
        <p>The Archivist demo runs against real on-device or web LLMs only; there is no canned fallback in the browser. To watch the DAG execute, enable one of:</p>
        <ul>
          <li><strong>Browser built-in LanguageModel (on-device):</strong> toggle <code>chrome://flags/#prompt-api-for-gemini-nano</code> and <code>chrome://flags/#optimization-guide-on-device-model</code>, restart, then visit <code>chrome://components</code> to trigger the model download. Implemented by Chrome 138+ and Edge.</li>
          <li><strong>Gemini API key:</strong> paste a free <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">AI Studio key</a> below; nothing leaves your browser except the request to Google.</li>
          <li><strong>WebLLM:</strong> needs WebGPU. Use a recent Chrome / Edge / Brave with hardware acceleration on.</li>
          <li><strong>Groq:</strong> free key at <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">console.groq.com/keys</a>. No GPU required.</li>
          <li><strong>Cerebras:</strong> free key at <a href="https://cloud.cerebras.ai/?utm=arch" target="_blank" rel="noreferrer">cloud.cerebras.ai</a>.</li>
          <li><strong>Mistral:</strong> free key at <a href="https://console.mistral.ai/api-keys/" target="_blank" rel="noreferrer">console.mistral.ai/api-keys/</a>.</li>
          <li><strong>OpenRouter:</strong> free key at <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">openrouter.ai/keys</a>.</li>
          <li><strong>Anthropic:</strong> key at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>.</li>
        </ul>
      </template>

      <BackendPicker
        :backends="backends"
        :active-id="activeBackend ?? ''"
        :api-keys="apiKeys"
        :ollama-model="ollamaModel"
        :is-mobile="isMobile"
        @update:active-id="activeBackend = $event as ProviderId"
        @update:api-keys="apiKeys = $event"
        @update:ollama-model="ollamaModel = $event"
      />
    </section>

    <!-- Main layout: two-column grid, container-query driven -->
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
                <!-- Slow-backend warning: browser built-in LanguageModel / WebLLM with no cloud key. -->
                <div v-if="showSlowBanner" class="slow-banner" role="note">
                  <span class="slow-banner-text">
                    <strong>Slow backend.</strong> You&rsquo;re using the browser&rsquo;s built-in
                    <code>LanguageModel</code>. Structured-output steps (tool selection,
                    candidate ranking) take 5&ndash;20s each on this backend. For 1&ndash;2s
                    responses, add a free Groq, Cerebras, Gemini API, Mistral, or
                    OpenRouter API key in the Config tab.
                  </span>
                  <button
                    type="button"
                    class="slow-banner-dismiss"
                    aria-label="Dismiss"
                    @click="dismissSlowBanner">&times;</button>
                </div>
                <Conversation :turns="conversation" />
                <SendForm
                  :query="visitorQuery"
                  :running="isRunning"
                  :terminal-variant="terminalVariant"
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
                    :active-id="activeBackend ?? ''"
                    :api-keys="apiKeys"
                    :ollama-model="ollamaModel"
                    :is-mobile="isMobile"
                    :disabled="isRunning"
                    @update:active-id="activeBackend = $event as ProviderId"
                    @update:api-keys="apiKeys = $event"
                    @update:ollama-model="ollamaModel = $event"
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
                  <ConversationContextPane @update:window-size="onConversationWindowUpdate" />
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
            <span class="ar-hint">{{ tripleCount }} triples</span>
          </div>
          <PanesTabs :tabs="rightTabs" default-key="dag" class="ar-tabs ar-tabs--right">

            <!-- DAG tab: live execution graph -->
            <template #dag>
              <div class="graph-pane">
                <DagGraph
                  v-if="archivistDag !== null"
                  ref="dagGraph"
                  :dag="archivistDag"
                  :embedded-d-a-gs="embeddedDagRegistry"
                  :node-variants="NODE_VARIANTS"
                  :expand-all="true"
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
              <TraceFeed :entries="trace" :log-events="logEvents" @node-click="onToolSelect" />
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

/* ── Slow-backend banner: gold-warning palette ───────────────────────── */
.slow-banner {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.6rem 0.8rem;
  border: 1px solid #d4a649;
  border-radius: 6px;
  background: rgba(212, 166, 73, 0.10);
  color: var(--vp-c-text-1);
  font-size: 0.82rem;
  line-height: 1.4;
}

.slow-banner-text {
  flex: 1 1 auto;
}

.slow-banner-text code {
  background: var(--vp-c-bg-elv);
  padding: 0.04rem 0.3rem;
  border-radius: 3px;
  font-family: var(--vp-font-family-mono);
  font-size: 0.78rem;
}

.slow-banner-dismiss {
  flex: 0 0 auto;
  background: transparent;
  border: none;
  color: #d4a649;
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
  padding: 0 0.25rem;
}

.slow-banner-dismiss:hover {
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

/* ── Two-column grid: iridis pattern ──────────────────────────────────── */
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

/* ── Shared graph pane: identical dimensions for DAG and Memory tabs ──── */
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
