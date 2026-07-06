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
 * Session orchestration is delegated to VueArchivistSession (extends
 * ArchivistSession). VueArchivistSession overrides the abstract seam
 * methods to write to the same reactive refs the template binds.
 */

import { computed, onMounted, ref, shallowRef, watch } from 'vue';

import { Checkpoint, CheckpointRestoreAdapter } from '@studnicky/dagonizer/checkpoint';
import type { ExecutionResultType } from '@studnicky/dagonizer';
import { ObservedDag } from '@studnicky/dagonizer';

import { ArchivistState } from '../../../../examples/the-archivist/ArchivistState.ts';
import { archivistDAG as canonicalArchivistDAG } from '../../../../examples/the-archivist/dag.ts';
import { DomConsoleLogger } from '../../../../examples/the-archivist/logger/DomConsoleLogger.ts';
import type { LogEvent } from '../../../../examples/the-archivist/logger/ConsoleLogger.ts';
import { MemoryStore } from '../../../../examples/the-archivist/memory/MemoryStore.ts';
import { ONTOLOGY_NTRIPLES } from '../../../../examples/the-archivist/ontology/ArchivistOntology.ts';
import { SeedLibrary } from '../../../../examples/the-archivist/data/SeedLibrary.ts';
import { RdfProvObserver } from '../../../../examples/the-archivist/provenance/RdfProvObserver.ts';
import { NODE_VARIANTS } from '../../../../examples/the-archivist/nodes/ArchivistNode.ts';
import { ArchivistNodes } from '../../../../examples/the-archivist/nodes/ArchivistNodes.ts';
import {
  ApiKeyStore,
  BackendMatrix,
  OllamaModels,
  ProviderInstantiator,
} from '../../../../examples/the-archivist/providers/index.ts';
import { MobileDetection } from '../../../../examples/the-archivist/providers/MobileDetection.ts';
import type {
  BackendAvailability,
  EmbedderProvisionOptionsType,
  EmbedderProvisionResultType,
  ProviderId,
} from '../../../../examples/the-archivist/providers/index.ts';
import type { IntentClassifier } from '../../../../examples/the-archivist/providers/IntentClassifier.ts';
import type { EmbedderInterface } from '@studnicky/dagonizer/contracts';
import type { ArchivistServices } from '../../../../examples/the-archivist/services.ts';
import { ToolRegistry } from '@studnicky/dagonizer/tool';
import { GoogleBooksTool } from '@studnicky/dagonizer-tool-googlebooks';
import { OpenLibrarySearchTool } from '@studnicky/dagonizer-tool-openlibrary';
import { SubjectSearchTool } from '@studnicky/dagonizer-tool-openlibrary';
import { WikipediaSummaryTool } from '@studnicky/dagonizer-tool-wikipedia';
import { bookSearchScatterDAG } from '../../../../examples/the-archivist/embedded-dags/BookSearchScatterDAG.ts';
import { composeRetryLoopDAG } from '../../../../examples/the-archivist/embedded-dags/ComposeRetryLoopDAG.ts';
import type { DAGType } from '@studnicky/dagonizer';

import {
  ArchivistSession,
} from '../../../../examples/the-archivist/ArchivistSession.ts';
import type {
  SessionDagEvent,
  SessionNodeEvent,
} from '../../../../examples/the-archivist/ArchivistSession.ts';

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
  session.setConversationContextWindow(size);
}

// ── Timeout settings ─────────────────────────────────────────────────────
const timeoutSettings = ref<TimeoutSettings>({
  'composeMs':   60_000,
  'webSearchMs': 60_000,
  'rankMs':      30_000,
});

function onTimeoutSettingsUpdate(settings: TimeoutSettings): void {
  timeoutSettings.value = settings;
  session.setTimeoutSettings(settings);
}

/**
 * Overall safety-net deadline: sum of all per-phase budgets plus a small
 * grace window. Used by the checkpoint resume path; the main ask() path
 * uses the session's internal deadline calculation.
 */
function overallDeadlineMs(): number {
  const { composeMs, webSearchMs, rankMs } = timeoutSettings.value;
  const grace = 5_000;
  return composeMs + webSearchMs + rankMs + grace;
}

// ── Cancel button ────────────────────────────────────────────────────────
// Abort controller for the checkpoint resume path (managed outside the session).
let activeAbortController: AbortController | null = null;

function cancel(): void {
  session.cancel();
  activeAbortController?.abort(new Error('cancelled by visitor'));
}

// ── Checkpoint ───────────────────────────────────────────────────────────
const CHECKPOINT_KEY = 'dagonizer-archivist-checkpoint';
const checkpointNode = ref<string | null>(null);
const hasCheckpoint = ref(
  typeof localStorage !== 'undefined' && localStorage.getItem('dagonizer-archivist-checkpoint') !== null
);
// lastResult and lastDagName are captured in session.onRunEnd() for the
// user-triggered saveCheckpoint() action.
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
    logger.note(`checkpoint saved at ${lastResult.cursor}`);
  } catch (err) {
    logger.warn(`checkpoint failed: ${err instanceof Error ? err.message : String(err)}`);
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

/** Live LLM client reference for ToolExplainPanel, kept in sync with activeBackend changes. */
const currentLlm = computed(() => makeLlm());

function clearMemory(): void {
  // Drop the accumulated memory facts but keep the schema: re-insert the TBox
  // ontology so the graph re-renders with its structure rather than going fully
  // empty. The seed library (run/book facts) is intentionally not restored —
  // that is what "clear" removes; use "Reset conversation" to reseed books.
  memoryStore.clear();
  memoryStore.loadOntology(ONTOLOGY_NTRIPLES);
  memoryTick.value++;
  logger.note('memory store cleared; ontology restored');
}

// ── Left-column tabs: Conversation | Memory ──────────────────────────────
const leftTabs = computed(() => [
  { 'key': 'conversation', 'label': 'Conversation', 'badge': '',                              'tone': 'default' as const },
  { 'key': 'memory',       'label': 'Memory',       'badge': String(tripleCount.value || ''), 'tone': 'accent'  as const },
]);

// ── Right-column tabs: DAG | Config | Trace ──────────────────────────────
const rightTabs = computed(() => {
  const traceCount = trace.value.length + logger.history().length;
  return [
    { 'key': 'dag',    'label': 'DAG',    'badge': isRunning.value ? 'live' : '', 'tone': (isRunning.value ? 'live' : 'default') as 'live' | 'default' },
    { 'key': 'config', 'label': 'Config', 'badge': '',                            'tone': 'default' as const },
    { 'key': 'trace',  'label': 'Trace',  'badge': String(traceCount || ''),      'tone': (isRunning.value ? 'live' : 'default') as 'live' | 'default' },
  ];
});

// Top-level archivist DAG reference for DagGraph display.
const archivistDag = ref<DAGType | null>(canonicalArchivistDAG);

// Embedded-DAG registry. Keys match the embeddedDAG placement names in the parent DAG.
const embeddedDagRegistry = ref<Map<string, DAGType>>(new Map([
  ['book-search-scatter', bookSearchScatterDAG],
  ['compose-retry-loop',  composeRetryLoopDAG],
]));

// Stable tool instances for the checkpoint resume path and archivistToolRegistry.
// One instance each: the HTTP tools are stateless.
const webSearchTool        = new OpenLibrarySearchTool();
const googleBooksTool      = new GoogleBooksTool();
const subjectSearchTool    = new SubjectSearchTool();
const wikipediaSummaryTool = new WikipediaSummaryTool();

// Tool registry: each tool becomes an embeddable `tool:<name>` DAG that the
// book-search scatter resolves at runtime via `{ dagFrom: 'dagName' }`. Must be
// registered before bookSearchScatterDAG or every scatter item fails to
// resolve its body DAG and routes to 'error'.
const archivistToolRegistry = new ToolRegistry();
archivistToolRegistry.register(webSearchTool);
archivistToolRegistry.register(googleBooksTool);
archivistToolRegistry.register(subjectSearchTool);
archivistToolRegistry.register(wikipediaSummaryTool);

/** Build a real services record for the checkpoint resume path. */
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
    'embedder':          embedder.value,
    'nodeTimeouts':      {},
  };
}

// ── VueArchivistSession ───────────────────────────────────────────────────
/**
 * Vue-specific ArchivistSession subclass. Overrides the abstract seam methods
 * to write to the reactive refs declared above, keeping the template reactive
 * to every session lifecycle event without callbacks or intermediate stores.
 *
 * Defined inside <script setup> so its method bodies close over the refs
 * directly — `trace`, `conversation`, `memoryTick`, `dagGraph`, etc. are
 * accessible by name from every override.
 */
class VueArchivistSession extends ArchivistSession {
  // ── Protected-field accessors for post-boot synchronization ─────────────
  // ArchivistSession sets these.activeBackend / isMobile internally during
  // boot(); these thin getters surface the values to the component scope.

  getActiveBackend(): ProviderId | null { return this.activeBackend; }
  getIsMobile(): boolean                { return this.isMobile; }
  setBackends(bs: readonly BackendAvailability[]): void { this.backends = bs; }

  // ── Extension seam: embedder provisioning ────────────────────────────────
  // Sync the Vue shallowRefs so makeLlm() and buildServices() (resume path)
  // pick up the provisioned embedder / intent classifier.

  protected override async provisionEmbedder(): Promise<EmbedderProvisionResultType> {
    const result = await super.provisionEmbedder();
    embedder.value         = result.embedder;
    intentClassifier.value = result.intentClassifier;
    return result;
  }

  // Point the transformers embedder at the model + WASM the
  // `transformersEmbedderAssets()` Vite plugin serves from this app's bundle
  // (under `{base}@transformers-embedder/`), so the vector intent classifier
  // runs fully offline in the browser.
  protected override embedderAssetPaths(): EmbedderProvisionOptionsType {
    const base = import.meta.env.BASE_URL;
    return {
      'transformersLocalModelPath': `${base}@transformers-embedder/models/`,
      'transformersWasmPaths':      `${base}@transformers-embedder/ort/`,
    };
  }

  // ── Abstract seam overrides ───────────────────────────────────────────────

  protected override onBackendsReady(
    newBackends: readonly BackendAvailability[],
    newNoModel: boolean,
  ): void {
    backends.value = newBackends;
    noModel.value  = newNoModel;
    isMobile.value = this.isMobile;
  }

  protected override onGreetingReady(greeting: string): void {
    conversation.value = [
      ...conversation.value,
      { 'role': 'archivist', 'text': greeting, 'ts': Date.now() },
    ];
  }

  protected override onSampleReplyReady(reply: string): void {
    visitorQuery.value = reply;
  }

  protected override onVisitorTurn(query: string): void {
    conversation.value = [
      ...conversation.value,
      { 'role': 'visitor', 'text': query, 'ts': Date.now() },
    ];
  }

  protected override onArchivistTurn(draft: string): void {
    conversation.value = [
      ...conversation.value,
      { 'role': 'archivist', 'text': draft, 'ts': Date.now() },
    ];
  }

  protected override onNodeEvent(event: SessionNodeEvent): void {
    // Trace: push the structured entry when the session provides one.
    const te = event.trace;
    if (te !== null) {
      switch (te.variant) {
        case 'start':
          trace.value = [...trace.value, { 'variant': 'start', 'node': te.node, 'ts': te.ts }];
          break;
        case 'end':
          trace.value = [...trace.value, { 'variant': 'end', 'node': te.node, 'ts': te.ts, 'output': te.output }];
          break;
        case 'note':
          trace.value = [...trace.value, { 'variant': 'note', 'node': te.node, 'ts': te.ts, 'message': te.message }];
          break;
        case 'error':
          trace.value = [...trace.value, { 'variant': 'error', 'node': te.node, 'ts': te.ts, 'message': te.message }];
          break;
      }
    }

    // DAG graph live-coloring + runner machine pulses.
    if (event.kind === 'nodeStart') {
      dagGraph.value?.setActive(event.fullId);
      runnerMachine.pulse({ 'type': 'nodeStart', 'node': event.node });
    } else {
      if (te?.variant === 'error') {
        dagGraph.value?.setErrored(event.fullId);
        runnerMachine.pulse({ 'type': 'nodeError', 'node': event.node, 'error': new Error(te.message) });
      } else {
        dagGraph.value?.setCompleted(event.fullId);
        if (event.output !== null) dagGraph.value?.markEdgeTraversed(event.fullId, event.output);
        runnerMachine.pulse(event.output === null
          ? { 'type': 'nodeEnd', 'node': event.node }
          : { 'type': 'nodeEnd', 'node': event.node, 'output': event.output });
      }
    }
  }

  protected override onDagEvent(event: SessionDagEvent): void {
    if (event.kind === 'flowEnd') {
      const lc = event.lifecycle;
      if (
        lc === 'completed' ||
        lc === 'failed'    ||
        lc === 'cancelled' ||
        lc === 'timed_out'
      ) {
        terminalVariant.value = lc;
      }
      memoryTick.value++;
      runnerMachine.dispatch({ 'type': 'flowEnd', 'lifecycle': lc });
    }
  }

  protected override onRunEnd(event: Extract<SessionDagEvent, { kind: 'flowEnd' }>): void {
    // Capture for the user-triggered saveCheckpoint() action.
    lastResult  = event.execution;
    lastDagName = event.dagName;
    if (event.cursor !== null) checkpointNode.value = event.cursor;
  }

  protected override onMemoryChanged(): void {
    memoryTick.value++;
  }

  protected override onError(error: Error): void {
    conversation.value = [
      ...conversation.value,
      { 'role': 'archivist', 'text': `(error: ${error.message})`, 'ts': Date.now() },
    ];
  }

  // Reload the ontology and seed library so the memory graph re-renders
  // with its schema and sample data after every reset.
  protected override onReset(): void {
    memoryStore.loadOntology(ONTOLOGY_NTRIPLES);
    SeedLibrary.loadInto(memoryStore);
    memoryTick.value++;
  }
}

// ── VueResumeObserver ────────────────────────────────────────────────────
/**
 * Thin observer for the checkpoint resume path. Extends ObservedDag to
 * receive lifecycle hooks, records PROV-O quads, and routes every event to
 * the session's pump methods so the same VueArchivistSession seam overrides
 * fire — giving the resume path identical trace-panel, DAG-graph, and
 * memory-graph behavior to a normal ask() run.
 */
class VueResumeObserver extends ObservedDag<ArchivistState> {
  readonly #session: VueArchivistSession;
  readonly #prov: RdfProvObserver;
  readonly #fromCursor: string;

  constructor(
    log: DomConsoleLogger,
    vueSession: VueArchivistSession,
    prov: RdfProvObserver,
    fromCursor: string,
  ) {
    super(log);
    this.#session    = vueSession;
    this.#prov       = prov;
    this.#fromCursor = fromCursor;
  }

  protected override onFlowStart(dagName: string, state: ArchivistState, signal: AbortSignal): void {
    super.onFlowStart(dagName, state, signal);
    dagGraph.value?.setActive(this.#fromCursor);
    this.#prov.recordFlowStart(dagName);
    this.#session.pumpFlowStart(dagName);
  }

  protected override onNodeStart(
    nodeName: string,
    state: ArchivistState,
    placementPath: readonly string[],
    signal: AbortSignal,
  ): void {
    super.onNodeStart(nodeName, state, placementPath, signal);
    this.#prov.recordNodeStart(nodeName);
    this.#session.pumpNodeStart(nodeName, placementPath);
  }

  protected override onNodeEnd(
    nodeName: string,
    output: string | null,
    state: ArchivistState,
    placementPath: readonly string[],
    signal: AbortSignal,
  ): void {
    super.onNodeEnd(nodeName, output, state, placementPath, signal);
    this.#prov.recordNodeEnd(nodeName, output ?? undefined, state.reasoning);
    this.#session.pumpNodeEnd(nodeName, output, state, placementPath);
  }

  protected override onError(
    nodeName: string,
    error: Error,
    state: ArchivistState,
    placementPath: readonly string[],
    signal: AbortSignal,
  ): void {
    super.onError(nodeName, error, state, placementPath, signal);
    this.#prov.recordError(nodeName, error);
    this.#session.pumpError(nodeName, error, placementPath);
  }

  // Phase enter/exit are internal scheduling markers; suppress the base
  // ObservedDag log lines so the trace feed reads as a clean node lifecycle.
  protected override onPhaseEnter(): void { /* suppressed */ }
  protected override onPhaseExit(): void  { /* suppressed */ }

  protected override onFlowEnd(
    dagName: string,
    state: ArchivistState,
    result: ExecutionResultType<ArchivistState>,
    signal: AbortSignal,
  ): void {
    super.onFlowEnd(dagName, state, result, signal);
    this.#prov.recordFlowEnd(state.lifecycle.variant);
    this.#session.pumpFlowEnd(dagName, state, result);
  }
}

// ── Session instantiation ─────────────────────────────────────────────────
const session = new VueArchivistSession(memoryStore, logger);

// ── Watchers ──────────────────────────────────────────────────────────────

// Persist and re-detect backend availability when apiKeys change; also keep
// the session in sync so its internal #resolveLlm() uses fresh keys + backends.
watch(apiKeys, async (keys) => {
  session.setApiKeys(keys);
  ApiKeyStore.save(keys);
  backends.value = await BackendMatrix.detect({
    'apiKeys': keys,
    ...(ollamaModel.value.length > 0 ? { 'preferredOllamaModel': ollamaModel.value } : {}),
  });
  noModel.value = BackendMatrix.hasNoRunnableModel(backends.value, { 'isMobile': isMobile.value });
  session.setBackends(backends.value);
}, { 'deep': true });

// Persist the visitor's backend selection and keep the session in sync.
watch(activeBackend, (id) => {
  session.setActiveBackend(id);
  if (typeof localStorage !== 'undefined' && id !== null) {
    localStorage.setItem('dagonizer-active-backend', id);
  }
});

// Persist the ollama model and keep the session in sync.
watch(ollamaModel, (next) => {
  session.setOllamaModel(next);
  OllamaModels.saveModel(next);
});

// ── Helpers ───────────────────────────────────────────────────────────────

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
  // Seed the memory store before the session boots so the memory graph shows
  // the ontology structure and sample books before any run.
  memoryStore.loadOntology(ONTOLOGY_NTRIPLES);
  SeedLibrary.loadInto(memoryStore);
  memoryTick.value++;

  // Push initial settings into the session before boot.
  session.setApiKeys(apiKeys.value);
  session.setOllamaModel(ollamaModel.value);
  session.setConversationContextWindow(conversationContextWindow.value);
  session.setTimeoutSettings(timeoutSettings.value);

  // Detect backends, provision embedder, select best backend.
  // onBackendsReady fires during boot() and syncs backends/noModel/isMobile refs.
  await session.boot();

  // Sync the backend chosen by boot() back to the Vue ref so the picker and
  // resolvedModel computed stay accurate.
  activeBackend.value = session.getActiveBackend();

  if (noModel.value) {
    logger.warn('no LLM backend detected; visitor must enable one');
    return;
  }

  // On a fresh session: generate the Archivist greeting (onGreetingReady
  // pushes it to conversation.value) and a contextual visitor reply
  // (onSampleReplyReady pre-fills the input).
  if (isFreshSession() && visitorQuery.value.length === 0) {
    const greeting = await session.greet();
    await session.sampleReply(greeting);
  }
});

// ── Run ──────────────────────────────────────────────────────────────────
async function ask(): Promise<void> {
  if (isRunning.value || visitorQuery.value.trim().length === 0 || activeBackend.value === null) return;

  const queryText = visitorQuery.value;
  // Clear the input immediately after capturing (the send-and-clear pattern).
  visitorQuery.value = '';

  runnerMachine.dispatch({ 'type': 'submit' });
  isRunning.value       = true;
  terminalVariant.value = 'pending';
  trace.value           = [];

  await dagGraph.value?.reset();
  memoryTick.value++;
  logger.clear();
  logger.note(`run start, query: "${queryText}"`);

  try {
    // session.ask() fires the full DAG run. Seam overrides above update all
    // reactive refs: onVisitorTurn, onNodeEvent, onDagEvent, onArchivistTurn,
    // onMemoryChanged, onRunEnd, onError.
    await session.ask(queryText);
  } catch (err) {
    // Only fatal pre-run errors reach here (e.g. no LLM available).
    // Errors during DAG execution are handled by session.onError().
    conversation.value = [
      ...conversation.value,
      {
        'role': 'archivist',
        'text': `(error: ${err instanceof Error ? err.message : String(err)})`,
        'ts': Date.now(),
      },
    ];
  } finally {
    isRunning.value = false;
  }
}

function reset(): void {
  conversation.value    = [];
  trace.value           = [];
  terminalVariant.value = 'pending';
  selectedSelection.value = null;
  selectedTool.value    = null;
  checkpointNode.value  = null;
  lastResult            = null;
  visitorQuery.value    = '';
  void dagGraph.value?.reset();
  runnerMachine.dispatch({ 'type': 'reset' });

  // session.reset() clears the session's conversation + store + logger,
  // calls onReset() (reloads ontology + seed), then runs greet() + sampleReply().
  // The seam overrides push the greeting to conversation.value and set visitorQuery.value.
  void session.reset();
}

// ── Checkpoint ────────────────────────────────────────────────────────────
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
  isRunning.value       = true;
  terminalVariant.value = 'pending';
  trace.value           = [];
  await dagGraph.value?.reset();
  memoryTick.value++;
  logger.clear();
  logger.note(`resuming from checkpoint at node: ${restored.cursor}`);

  const runId = restored.state.runId !== ''
    ? restored.state.runId
    : (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `r-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;

  const prov = new RdfProvObserver({
    'store':                      memoryStore,
    'runId':                      runId,
    'dispatcherAgentId':          `dispatcher:${activeBackend.value}`,
    'alreadyPersistedReasoning':  restored.state.reasoning,
  });

  let observer: VueResumeObserver | null = null;

  try {
    const services = buildServices();
    const nodes = ArchivistNodes.build(services);

    observer = new VueResumeObserver(logger, session, prov, restored.cursor);

    observer.registerBundle(archivistToolRegistry.bundle());
    observer.registerBundle({ 'nodes': nodes.bookSearchScatterNodes, 'dags': [bookSearchScatterDAG] });
    observer.registerBundle({ 'nodes': nodes.composeRetryLoopNodes, 'dags': [composeRetryLoopDAG] });
    observer.registerBundle({ 'nodes': nodes.parentNodes, 'dags': [canonicalArchivistDAG] });

    activeAbortController = new AbortController();
    const deadlineMs = overallDeadlineMs();

    await observer.resume(
      restored.dagName,
      restored.state,
      restored.cursor,
      { 'signal': activeAbortController.signal, 'deadlineMs': deadlineMs },
    );
  } catch (error) {
    conversation.value = [
      ...conversation.value,
      {
        'role': 'archivist',
        'text': `(error: ${error instanceof Error ? error.message : String(error)})`,
        'ts': Date.now(),
      },
    ];
  } finally {
    await observer?.destroy();
    activeAbortController = null;
    isRunning.value = false;
  }
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

        <!-- LEFT: Conversation | Memory -->
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
          </PanesTabs>
        </div>

        <!-- RIGHT: DAG | Config | Trace -->
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
