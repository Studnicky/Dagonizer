/**
 * ArchivistSession: framework-agnostic orchestration base class.
 *
 * Owns the shared session lifecycle used by `ArchivistRunner.vue`
 * (Vue reactive refs) and `main.ts` (DOM imperative). Both frontends extend this class and override the
 * abstract seam methods to drive their respective view layers.
 *
 * Extension model:
 *   Subclass this class. Override the abstract `on*` methods to react to
 *   session events (backends detected, greeting ready, node events, run end,
 *   etc.). Never pass callbacks; always override.
 *
 * LLM injection seam:
 *   Pass `{ llm }` in `options` to bypass `BackendMatrix.detect` and
 *   `ProviderInstantiator`. This is the headless-test and main.ts path; the
 *   Vue runner lets the session do auto-detection via `boot()`.
 *
 * Tool injection seam:
 *   Override `buildRig(llm, embedder)` to supply stub tools in tests.
 *   The default builds real HTTP tool instances.
 *
 * Durability seam:
 *   `onRunEnd` receives the full `ExecutionResultType<ArchivistState>` and
 *   `dagName`. From these, a subclass can call `Checkpoint.capture` (for Vue
 *   checkpoint save) or `IndexedDbCheckpointStore.persist` (for main.ts HITL).
 *   HITL park info (`result.parked`) is surfaced here; the base class has no
 *   IndexedDB or localStorage dependency.
 *
 * Static sample pools:
 *   `STATIC_GREETINGS` and `STATIC_VISITOR_REPLIES` are module constants shared
 *   by every frontend.
 */

import type { ExecutionResultType } from '@studnicky/dagonizer';
import { ObservedDag } from '@studnicky/dagonizer';
import type { DagLoggerInterface } from '@studnicky/dagonizer';
import { Clock as SubstrateClock, RealTimeClockProvider } from '@studnicky/clock';
import { ToolInvocationState, ToolRegistry } from '@studnicky/dagonizer/tool';
import type { EmbedderInterface } from '@studnicky/dagonizer/contracts';
import type { ExecuteOptionsType } from '@studnicky/dagonizer/contracts';

import { GoogleBooksTool } from '@studnicky/dagonizer-tool-googlebooks';
import { OpenLibrarySearchTool, SubjectSearchTool } from '@studnicky/dagonizer-tool-openlibrary';
import { WikipediaSummaryTool } from '@studnicky/dagonizer-tool-wikipedia';

import { ArchivistState } from './ArchivistState.ts';
import type { ConversationTurn } from './ArchivistState.ts';
import { archivistDAG } from './dag.ts';
import { bookSearchScatterDAG } from './embedded-dags/BookSearchScatterDAG.ts';
import { composeRetryLoopDAG } from './embedded-dags/ComposeRetryLoopDAG.ts';
import { ConsoleLogger } from './logger/ConsoleLogger.ts';
import { MemoryStore } from './memory/MemoryStore.ts';
import { ArchivistNodes } from './nodes/ArchivistNodes.ts';
import {
  ActiveBackendStore,
  ApiKeyStore,
  BackendMatrix,
  EmbedderProvisioner,
  PreferredModels,
  ProviderInstantiator,
} from './providers/index.ts';
import type {
  BackendAvailability,
  EmbedderProvisionOptionsType,
  EmbedderProvisionResultType,
  ProviderId,
  WebLlmInitReportType,
} from './providers/index.ts';
import type { IntentClassifier } from './providers/IntentClassifier.ts';
import { MobileDetection } from './providers/MobileDetection.ts';
import { RdfProvObserver } from './provenance/RdfProvObserver.ts';
import type { ArchivistServices, LlmClientInterface } from './services.ts';
import { StateProjection } from './state/StateProjection.ts';
import { UserLanguage } from './language/UserLanguage.ts';

// ── Static sample pools ───────────────────────────────────────────────────────
// Single source of truth for every Archivist frontend.

const ARCHIVIST_DAG_IRI = 'urn:noocodec:dag:the-archivist';

export const STATIC_GREETINGS: readonly string[] = [
  'Welcome to the shop. The shelves remember everything they hold. What brings you in?',
  'Stay a while. I have a long list of books and a longer one of questions about them.',
  'A reader, then. Tell me what you are looking for, and I will see what the catalog gives up.',
  'The door is always open here. Name a title, an author, or a feeling, and I will look.',
  'Good to see you. The shelves run deep on every subject. Where would you like to begin?',
  'Come in. I keep records on almost everything ever printed. What can I find for you?',
  'Every visitor arrives with a question worth answering. What is yours?',
];

export const STATIC_VISITOR_REPLIES: readonly string[] = [
  'Something like Neuromancer but written in the last five years?',
  "Where should I start with Stanisław Lem?",
  "A novel about time that doesn't lean on time-travel tropes.",
  "Anything Wittgenstein-adjacent that doesn't require a logic background?",
  "What's the best translation of the Three Body Problem trilogy?",
  'Do you have anything that pairs Ted Chiang with Borges?',
  'Philosophy for someone who just finished Annihilation.',
];

// ── Event payload types ──────────────────────────────────────────────────────

export type SessionTraceVariant = 'start' | 'end' | 'note' | 'error';

/**
 * A single structured trace entry emitted during node lifecycle events.
 *
 * Vue subclass: push to a reactive `trace` ref for TraceFeed display.
 * DOM subclass: log to console or DOM panel.
 * Headless test: collect into an array for assertion.
 */
export interface SessionTraceEntry {
  readonly node: string;
  readonly ts: number;
  readonly variant: SessionTraceVariant;
  readonly output: string | null;
  readonly message: string;
}

/**
 * Structured payload delivered to `onNodeEvent`.
 *
 * `trace` is populated for top-level (non-scatter-inner) nodes only; it is
 * `null` for inner tool-clone nodes (those emit a muted `note` entry instead).
 * `fullId` joins `placementPath` and `nodeName` with `/`, matching the
 * cytoscape node id format used by `DagGraph`.
 */
export interface SessionNodeEvent {
  readonly kind: 'nodeStart' | 'nodeEnd';
  readonly node: string;
  readonly fullId: string;
  readonly placementPath: readonly string[];
  readonly output: string | null;
  readonly trace: SessionTraceEntry | null;
  readonly ts: number;
}

/**
 * Structured payload delivered to `onDagEvent`.
 *
 * `flowEnd` events carry the full `ExecutionResultType` so subclasses can
 * implement durability (Checkpoint capture, IndexedDB persist, HITL park)
 * without those concerns living in the base class.
 */
export type SessionDagEvent =
  | { readonly kind: 'flowStart'; readonly dagName: string }
  | {
      readonly kind: 'flowEnd';
      readonly dagName: string;
      readonly lifecycle: string;
      readonly draft: string;
      readonly cursor: string | null;
      readonly execution: ExecutionResultType<ArchivistState>;
    };

/** Timeout budgets in milliseconds for the three rate-limiting categories. */
export interface SessionTimeoutSettings {
  readonly composeMs: number;
  readonly webSearchMs: number;
  readonly rankMs: number;
}

/** Internal tool+services bundle returned by `buildRig`. */
export interface SessionRig {
  readonly services: ArchivistServices;
  readonly toolRegistry: ToolRegistry;
}

/** Module-level default timeout budgets. */
const DEFAULT_TIMEOUT_SETTINGS: SessionTimeoutSettings = {
  composeMs:   60_000,
  webSearchMs: 60_000,
  rankMs:      30_000,
};

/**
 * Constructor options for `ArchivistSession`.
 *
 * All fields are optional-input and resolve to defaults when absent. The
 * `llm` field is the injection seam for headless tests and `main.ts`:
 * when provided, `boot()` skips `BackendMatrix.detect` and uses the
 * injected client directly.
 */
export interface ArchivistSessionOptions {
  readonly conversationContextWindow?: number;
  readonly timeoutSettings?: Partial<SessionTimeoutSettings>;
  /** Clock for session timestamps and deterministic sample selection. */
  readonly clock?: SubstrateClock;
  /** Pre-built LlmClientInterface; bypasses BackendMatrix when set. */
  readonly llm?: LlmClientInterface;
  /** WebLLM progress callback for browser frontends. */
  readonly onWebLlmProgress?: (report: WebLlmInitReportType) => void;
  /**
   * Visitor's device language (ISO 639-1), threaded into the LLM client's
   * prompts and into `ArchivistState.userLanguage` (tool-arg language
   * restriction, candidate language filtering). Defaults to
   * `UserLanguage.detect()` (browser `navigator.language`, Node
   * `process.env.LANG`, else `'en'`) when not supplied.
   */
  readonly visitorLanguage?: string;
}

// ── Node-trace dispatch map ──────────────────────────────────────────────────
// After key nodes complete, log what the search pipeline did. Equivalent of
// ARCHIVIST_NODE_TRACE in ArchivistRunner.vue, expressed as string-returning
// entries so the session can both log and emit them as supplemental trace info.

const NODE_TRACE_MESSAGES: Readonly<Record<string, (state: ArchivistState) => string>> = {
  'extract-query': (state) => `terms: [${state.terms.join(', ')}]`,
  'build-book-worksets': (state) => {
    if (state.bookWorksets.length === 0) return 'search: no worksets built — no tools will run';
    return state.bookWorksets.map((ws) => {
      const a = ws.arguments;
      const q = a['query'] ?? a['isbn'] ?? a['author'] ?? a['subject'] ?? '?';
      return `search: ${ws.dagIri.replace('urn:noocodec:tool:', '')} → "${String(q)}"`;
    }).join(' | ');
  },
  'rank-candidates': (state) => `candidates from tools: ${String(state.candidates.length)}`,
  'merge-candidates': (state) =>
    `shortlist: ${String(state.shortlist.length)} · prior-memory: ${String(state.priorCandidates.length)}`,
};

// ── Internal event sink interface ────────────────────────────────────────────
// SessionObserver is module-level (not exported). It pumps ObservedDag
// lifecycle events back into the session via this typed interface.
// These are concrete methods on ArchivistSession — not abstract, not
// intended as override points for consumers of the session.

interface SessionEventSinkInterface {
  pumpFlowStart(dagName: string): void;
  pumpNodeStart(nodeName: string, placementPath: readonly string[]): void;
  pumpNodeEnd(nodeName: string, output: string | null, state: ArchivistState, placementPath: readonly string[]): void;
  pumpError(nodeName: string, error: Error, placementPath: readonly string[]): void;
  pumpFlowEnd(dagName: string, state: ArchivistState, result: ExecutionResultType<ArchivistState>): void;
}

// ── SessionObserver ──────────────────────────────────────────────────────────
// Per-run observer. Extends ObservedDag to receive lifecycle hook calls,
// records PROV-O quads, and routes structured events to the session sink.
// Not exported; created fresh per ask() / resume() call inside the session.

class SessionObserver extends ObservedDag<ArchivistState> {
  readonly #sink: SessionEventSinkInterface;
  readonly #prov: RdfProvObserver;
  #shownErrorCount: number;

  constructor(
    logger: DagLoggerInterface,
    sink: SessionEventSinkInterface,
    prov: RdfProvObserver,
  ) {
    super(logger);
    this.#sink = sink;
    this.#prov = prov;
    this.#shownErrorCount = 0;
  }

  protected override onFlowStart(dagName: string, state: ArchivistState, signal: AbortSignal): void {
    super.onFlowStart(dagName, state, signal);
    this.#prov.recordFlowStart(dagName);
    this.#sink.pumpFlowStart(dagName);
  }

  protected override onNodeStart(
    nodeName: string,
    state: ArchivistState,
    placementPath: readonly string[],
    signal: AbortSignal,
  ): void {
    super.onNodeStart(nodeName, state, placementPath, signal);
    this.#prov.recordNodeStart(nodeName);
    this.#sink.pumpNodeStart(nodeName, placementPath);
  }

  protected override onNodeEnd(
    nodeName: string,
    output: string | null,
    state: ArchivistState,
    placementPath: readonly string[],
    signal: AbortSignal,
  ): void {
    super.onNodeEnd(nodeName, output, state, placementPath, signal);

    // Surface routed-to-'error' failures collected on top-level state.
    // Tolerated tool-clone failures (toolExecutionFailed) are filtered: they
    // surface as muted 'note' rows via the inner-node path below.
    if (state instanceof ArchivistState) {
      for (let i = this.#shownErrorCount; i < state.errors.length; i++) {
        const err = state.errors[i];
        if (err !== undefined && err.code !== 'toolExecutionFailed') {
          this.#sink.pumpError(
            err.operation !== '' ? err.operation : nodeName,
            new Error(`${err.code}: ${err.message}`),
            placementPath,
          );
        }
      }
      this.#shownErrorCount = state.errors.length;
    }

    const reasoning = state instanceof ArchivistState ? state.reasoning : [];
    this.#prov.recordNodeEnd(nodeName, output ?? undefined, reasoning);
    this.#sink.pumpNodeEnd(nodeName, output, state, placementPath);
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
    this.#sink.pumpError(nodeName, error, placementPath);
  }

  // Phase enter/exit are internal scheduling markers; suppress the base
  // ObservedDag log lines so the trace feed reads as a clean node lifecycle.
  protected override onPhaseEnter(): void {
    // intentionally suppressed
  }

  protected override onPhaseExit(): void {
    // intentionally suppressed
  }

  protected override onFlowEnd(
    dagName: string,
    state: ArchivistState,
    result: ExecutionResultType<ArchivistState>,
    signal: AbortSignal,
  ): void {
    super.onFlowEnd(dagName, state, result, signal);
    this.#prov.recordFlowEnd(state.lifecycle.variant);
    this.#sink.pumpFlowEnd(dagName, state, result);
  }
}

// ── ArchivistSession ─────────────────────────────────────────────────────────

/**
 * ArchivistSession: framework-agnostic Archivist orchestrator.
 *
 * Owns:
 *   - Backend detection and selection (`boot()`)
 *   - Greeting and visitor-reply generation (`greet()`, `sampleReply()`)
 *   - The full DAG run loop (`ask()`)
 *   - Conversation history accumulation in the RDF memory graph
 *   - A single `reset()` implementation (eliminates the onMounted/reset duplication)
 *
 * Does NOT own:
 *   - Vue reactivity (no refs, no watches, no computed)
 *   - DOM manipulation
 *   - IndexedDB / localStorage durability (exposed via `onRunEnd`)
 *   - App-store orchestration (subclass or caller responsibility)
 */
export abstract class ArchivistSession implements SessionEventSinkInterface {
  // ── Injected at construction (required) ───────────────────────────────────
  protected readonly store: MemoryStore;
  protected readonly logger: ConsoleLogger;

  // ── Session config (mutable via set* methods) ─────────────────────────────
  protected conversationContextWindow: number;
  protected timeoutSettings: SessionTimeoutSettings;
  protected visitorLanguage: string;

  // ── Backend state ─────────────────────────────────────────────────────────
  protected activeBackend: ProviderId | null;
  protected apiKeys: Partial<Record<ProviderId, string>>;
  protected preferredModels: Partial<Record<ProviderId, string>>;
  protected isMobile: boolean;
  protected backends: readonly BackendAvailability[];
  protected embedder: EmbedderInterface | null;
  protected intentClassifier: IntentClassifier | null;

  // ── Conversation mirror (RDF memory graph remains authoritative) ─────────
  conversation: ConversationTurn[];

  // ── Private run plumbing (shape-stable; always present) ──────────────────
  readonly #clock: SubstrateClock;
  readonly #injectedLlm: LlmClientInterface | null;
  readonly #onWebLlmProgress: ((report: WebLlmInitReportType) => void) | null;
  #abortController: AbortController | null;
  #isRunning: boolean;

  constructor(store: MemoryStore, logger: ConsoleLogger, options: ArchivistSessionOptions = {}) {
    this.store                   = store;
    this.logger                  = logger;
    this.conversationContextWindow = options.conversationContextWindow ?? 6;
    this.visitorLanguage         = options.visitorLanguage ?? UserLanguage.detect();
    this.timeoutSettings         = {
      composeMs:   options.timeoutSettings?.composeMs   ?? DEFAULT_TIMEOUT_SETTINGS.composeMs,
      webSearchMs: options.timeoutSettings?.webSearchMs ?? DEFAULT_TIMEOUT_SETTINGS.webSearchMs,
      rankMs:      options.timeoutSettings?.rankMs      ?? DEFAULT_TIMEOUT_SETTINGS.rankMs,
    };
    this.activeBackend    = null;
    this.apiKeys          = ApiKeyStore.load();
    this.preferredModels  = PreferredModels.load();
    this.isMobile         = false;
    this.backends         = [];
    this.embedder         = null;
    this.intentClassifier = null;
    this.conversation     = [];
    this.#clock           = options.clock ?? SubstrateClock.create(RealTimeClockProvider.create());
    this.#injectedLlm     = options.llm ?? null;
    this.#onWebLlmProgress = options.onWebLlmProgress ?? null;
    this.#abortController = null;
    this.#isRunning       = false;
  }

  // ── Config mutators ───────────────────────────────────────────────────────

  setApiKeys(keys: Partial<Record<ProviderId, string>>): void {
    this.apiKeys = keys;
  }

  setOllamaModel(model: string): void {
    this.preferredModels = PreferredModels.set('ollama', model);
  }

  setPreferredModels(models: Partial<Record<ProviderId, string>>): void {
    this.preferredModels = models;
    PreferredModels.save(models);
  }

  setActiveBackend(id: ProviderId | null): void {
    this.activeBackend = id;
  }

  setConversationContextWindow(size: number): void {
    this.conversationContextWindow = size;
  }

  setTimeoutSettings(settings: SessionTimeoutSettings): void {
    this.timeoutSettings = settings;
  }

  // ── Extension seam: tool + services construction ─────────────────────────

  /**
   * Build the tool registry and services record for a single run.
   *
   * Override in test subclasses to inject stub tools (returning empty
   * candidates without HTTP calls). The base implementation constructs
   * real HTTP tool instances.
   *
   * The same tool instances MUST appear in both `services` and `toolRegistry`
   * because the DAG's scatter body resolves tool DAG IRIs from
   * the registry, and the node implementations call `services.webSearch`, etc.
   */
  protected buildRig(llm: LlmClientInterface, embedder: EmbedderInterface | null): SessionRig {
    const webSearch        = new OpenLibrarySearchTool();
    const googleBooks      = new GoogleBooksTool();
    const subjectSearch    = new SubjectSearchTool();
    const wikipediaSummary = new WikipediaSummaryTool();

    const toolRegistry = new ToolRegistry();
    toolRegistry.register(webSearch);
    toolRegistry.register(googleBooks);
    toolRegistry.register(subjectSearch);
    toolRegistry.register(wikipediaSummary);

    const { composeMs, webSearchMs, rankMs } = this.timeoutSettings;
    const services: ArchivistServices = {
      'webSearch':         webSearch,
      'googleBooks':       googleBooks,
      'subjectSearch':     subjectSearch,
      'wikipediaSummary':  wikipediaSummary,
      'llm':               llm,
      'memory':            this.store,
      'embedder':          embedder,
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

    return { services, toolRegistry };
  }

  /**
   * Provision the browser embedder and intent classifier.
   *
   * Override in test subclasses to return `{ embedder: null, intentClassifier: null }`
   * so no CDN imports or GPU probes run during testing.
   */
  protected async provisionEmbedder(): Promise<EmbedderProvisionResultType> {
    return EmbedderProvisioner.provision(this.embedderAssetPaths());
  }

  /**
   * Served asset paths for the on-device transformers embedder (model + WASM),
   * so it loads fully offline from the app bundle. Default empty — the embedder
   * uses its package-local vendored weights (node/headless). A browser
   * frontend overrides this to return the bundler-served paths.
   */
  protected embedderAssetPaths(): EmbedderProvisionOptionsType {
    return {};
  }

  // ── Public orchestration methods ──────────────────────────────────────────

  /**
   * Detect available backends, provision the embedder, and select the
   * best available backend (honoring saved preferences).
   *
   * Calls `onBackendsReady` when detection completes so the subclass can
   * update its backend picker UI.
   *
   * When `options.llm` was supplied at construction, detection is skipped and
   * the injected LLM is used directly; `onBackendsReady` is still called with
   * an empty `backends` array and `noModel = false`.
   */
  async boot(): Promise<void> {
    this.isMobile = MobileDetection.isLikelyMobile();

    if (this.#injectedLlm !== null) {
      // Injection path: skip detection entirely.
      this.onBackendsReady([], false);
      // Provision embedder in background; errors are swallowed gracefully.
      void this.provisionEmbedder().then((r) => {
        this.embedder         = r.embedder;
        this.intentClassifier = r.intentClassifier;
      });
      return;
    }

    this.backends = await BackendMatrix.detect({
      'apiKeys': this.apiKeys,
      'preferredModels': this.preferredModels,
    });

    // Provision embedder concurrently without blocking backend selection.
    void this.provisionEmbedder().then((r) => {
      this.embedder         = r.embedder;
      this.intentClassifier = r.intentClassifier;
    });

    const noModel = BackendMatrix.hasNoRunnableModel(this.backends, { 'isMobile': this.isMobile });
    this.onBackendsReady(this.backends, noModel);

    if (noModel) return;

    // Honor saved preference when runnable; otherwise pick best available.
    const savedId = ArchivistSession.#loadSavedBackend();
    const savedEntry = savedId !== null
      ? (this.backends.find((b) => b.id === savedId) ?? null)
      : null;

    if (savedEntry !== null && savedEntry.runnable) {
      this.activeBackend = savedEntry.id;
      this.logger.info(
        {
          'context': { 'backendId': savedEntry.id, 'source': 'saved-preference' },
          'event': 'archivist.backend-select',
          'message': `backend from saved preference: ${savedEntry.id}`,
          'status': 'complete',
        },
      );
    } else {
      const picked = BackendMatrix.pickBest(this.backends, { 'isMobile': this.isMobile });
      if (picked !== null) {
        this.activeBackend = picked.id;
        this.logger.info(
          {
            'context': { 'backendId': picked.id, 'source': savedId === null ? 'auto' : 'available-default' },
            'event': 'archivist.backend-select',
            'message': savedId === null
              ? `backend auto-selected: ${picked.displayName}`
              : `saved preference "${savedId}" unavailable; defaulting to ${picked.displayName}`,
            'status': 'complete',
          },
        );
      }
    }
  }

  /**
   * Generate and emit the Archivist greeting for a fresh session.
   *
   * Tries the LLM first; uses a static sample when the LLM is unavailable or
   * throws. Calls `onGreetingReady(greeting)` with the result.
   *
   * Returns the greeting text so callers can chain `sampleReply(greeting)`.
   */
  async greet(): Promise<string> {
    const llm = this.#resolveLlm();
    let greeting = this.#staticGreeting();

    if (llm !== null) {
      try {
        const generated = await llm.suggestGreeting();
        if (generated.length > 0) greeting = generated;
      } catch {
        // Static sample remains selected.
      }
    }

    const turn = this.#recordConversationTurn('archivist', greeting);
    const text = turn?.text ?? '';
    this.onGreetingReady(text);
    return text;
  }

  /**
   * Generate and emit a visitor-style reply to the supplied greeting.
   *
   * Uses a manually seeded visitor message so the conversation starts with a
   * stable visitor turn rather than an LLM-authored simulation.
   */
  async sampleReply(_greeting: string): Promise<string> {
    const reply = this.#staticVisitorReply();
    const turn = this.#recordConversationTurn('visitor', reply);
    const text = turn?.text ?? '';
    this.onSampleReplyReady(text);
    return text;
  }

  /**
   * Run the Archivist DAG for a visitor turn that is already in the RDF-backed
   * conversation graph.
   *
   * Bootstrap UIs use this after `sampleReply()` so the seeded visitor prompt is
   * answered by the same DAG path as a typed visitor message without rendering
   * or recording that visitor turn a second time. If no matching recorded turn
   * exists, the method falls back to `ask()` semantics and records it.
   */
  async answerRecordedVisitorTurn(query: string): Promise<void> {
    const cleanQuery = ArchivistSession.#messageText(query);
    const recordedTurn = this.#lastRecordedVisitorTurn(cleanQuery);
    await this.#runVisitorQuery(cleanQuery, recordedTurn ?? undefined);
  }

  /**
   * Run the Archivist DAG for a visitor query.
   *
   * Sequence:
   *   1. Push visitor turn to the RDF memory graph; call `onVisitorTurn(query)`.
   *   2. Build a fresh `SessionObserver`, assemble bundles, execute the DAG.
   *   3. During execution, lifecycle events fire `onNodeEvent` / `onDagEvent`.
   *   4. On completion: push archivist turn (if draft non-empty); call
   *      `onArchivistTurn(draft)` then `onRunEnd(event)`.
   *   5. On error: call `onError(err)`.
   *
   * The `onRunEnd` event carries the full `ExecutionResultType` and `dagName`
   * so subclasses can implement durability (Checkpoint capture, HITL park
   * persist, etc.) without the base class owning any storage.
   *
   * Throws when no LLM is available.
   */
  async ask(query: string): Promise<void> {
    await this.#runVisitorQuery(query);
  }

  async #runVisitorQuery(query: string, recordedVisitorTurn?: ConversationTurn): Promise<void> {
    if (this.#isRunning) {
      throw new Error('ArchivistSession.ask: a run is already in progress; call cancel() first');
    }

    const llm = this.#resolveLlm();
    if (llm === null) throw new Error('ArchivistSession.ask: no LLM available; call boot() first');

    const cleanQuery = ArchivistSession.#messageText(query);
    const visitorTurn = recordedVisitorTurn ?? this.#recordConversationTurn('visitor', cleanQuery);
    if (recordedVisitorTurn === undefined && visitorTurn !== null) this.onVisitorTurn(visitorTurn.text);

    this.#isRunning = true;
    this.#abortController = new AbortController();

    const runId = this.#generateRunId();
    StateProjection.clear(runId, this.store);

    const prov = new RdfProvObserver({
      'store':             this.store,
      'runId':             runId,
      'dispatcherAgentId': `dispatcher:${this.activeBackend ?? 'injected'}`,
      'clock':             this.#clock,
      'alreadyPersistedReasoning': [],
    });

    const rig = this.buildRig(llm, this.embedder);
    const nodes = ArchivistNodes.build(rig.services);

    const observer = new SessionObserver(this.logger, this, prov);
    observer.registerBundle(rig.toolRegistry.bundle());
    observer.registerBundle({ 'nodes': nodes.bookSearchScatterNodes, 'dags': [bookSearchScatterDAG] });
    observer.registerBundle({ 'nodes': nodes.composeRetryLoopNodes, 'dags': [composeRetryLoopDAG] });
    observer.registerBundle({ 'nodes': nodes.parentNodes, 'dags': [archivistDAG] });

    const visitor = new ArchivistState();
    visitor.query    = visitorTurn?.text ?? cleanQuery;
    visitor.runId    = runId;
    visitor.userLanguage = this.visitorLanguage;
    visitor.conversation = this.#conversationContextFromMemory(visitorTurn ?? undefined);

    const { composeMs, webSearchMs, rankMs } = this.timeoutSettings;
    const deadlineMs = composeMs + webSearchMs + rankMs + 5_000;

    const executeOptions: ExecuteOptionsType = {
      'signal':     this.#abortController.signal,
      'deadlineMs': deadlineMs,
    };

    try {
      await observer.execute(ARCHIVIST_DAG_IRI, visitor, executeOptions);
    } catch (err) {
      this.onError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      await observer.destroy();
      this.#abortController = null;
      this.#isRunning = false;
    }
  }

  /**
   * Reset the session to a blank slate and run the bootstrap sequence.
   *
   * Clears conversation history, clears the logger, then calls
   * `greet()` + `sampleReply()` through the single shared implementation.
   *
   * The memory store is cleared via `store.clear()`. Subclasses that
   * manage a seed library should reload it by overriding `onReset`.
   */
  async reset(): Promise<void> {
    this.conversation = [];
    this.store.clear();
    this.logger.clear();
    this.onReset();
    const greeting = await this.greet();
    await this.sampleReply(greeting);
  }

  /**
   * Abort the current run if one is in progress.
   *
   * The abort signal is forwarded to the dispatcher; the run's `onRunEnd`
   * will fire with a `cancelled` or `timed_out` lifecycle when the abort
   * takes effect.
   */
  cancel(): void {
    this.#abortController?.abort(new Error('cancelled by visitor'));
  }

  /**
   * Resume a parked flow from a recalled checkpoint.
   *
   * Called by durability-aware subclasses (e.g. `DomArchivistSession`) after
   * the checkpoint has been recalled and the stores have been restored via
   * `Checkpoint.recall` + `recalled.restoreStores`. The subclass sets
   * `state.query` before calling, injects the human text into its own DOM,
   * and pushes visitor bubbles directly; this method handles only the session
   * bookkeeping and the DAG execution machinery.
   *
   * Appends a visitor turn to the memory-backed conversation, then resumes the
   * DAG at `cursor`. All node events and the final `onRunEnd` fire
   * exactly as they do for `ask()`, so `onRunEnd` handles durability clean-up
   * (clearing `hitl:pendingKey`, persisting the memory graph) in the subclass.
   */
  protected async resumeRun(
    humanText: string,
    dagName: string,
    state: ArchivistState,
    cursor: string,
  ): Promise<void> {
    if (this.#isRunning) {
      throw new Error('ArchivistSession.resumeRun: a run is already in progress; call cancel() first');
    }

    const llm = this.#resolveLlm();
    if (llm === null) throw new Error('ArchivistSession.resumeRun: no LLM available; call boot() first');

    const visitorTurn = this.#recordConversationTurn('visitor', humanText);
    state.conversation = this.#conversationContextFromMemory(visitorTurn ?? undefined);
    if (visitorTurn !== null) state.query = visitorTurn.text;

    this.#isRunning = true;
    this.#abortController = new AbortController();

    // Park/resume is the SAME logical run: the checkpointed `state.runId`
    // carries forward so the prov graph continues instead of restarting.
    // `state.reasoning` already holds every step persisted before the park
    // (via the pre-park observer's writes); it becomes the resume
    // observer's high-water mark so those steps are never re-persisted and
    // the `wasInformedBy` chain continues from the true last entity rather
    // than starting a disconnected one.
    if (state.runId === '') {
      throw new Error('ArchivistSession.resumeRun: restored state has no runId; cannot resume the PROV chain');
    }
    const runId = state.runId;
    StateProjection.clear(runId, this.store);

    const prov = new RdfProvObserver({
      'store':             this.store,
      'runId':             runId,
      'dispatcherAgentId': `dispatcher:${this.activeBackend ?? 'injected'}`,
      'clock':             this.#clock,
      'alreadyPersistedReasoning': state.reasoning,
    });

    const rig = this.buildRig(llm, this.embedder);
    const nodes = ArchivistNodes.build(rig.services);

    const observer = new SessionObserver(this.logger, this, prov);
    observer.registerBundle(rig.toolRegistry.bundle());
    observer.registerBundle({ 'nodes': nodes.bookSearchScatterNodes, 'dags': [bookSearchScatterDAG] });
    observer.registerBundle({ 'nodes': nodes.composeRetryLoopNodes, 'dags': [composeRetryLoopDAG] });
    observer.registerBundle({ 'nodes': nodes.parentNodes, 'dags': [archivistDAG] });

    const { composeMs, webSearchMs, rankMs } = this.timeoutSettings;
    const deadlineMs = composeMs + webSearchMs + rankMs + 5_000;

    const executeOptions: ExecuteOptionsType = {
      'signal':     this.#abortController.signal,
      'deadlineMs': deadlineMs,
    };

    try {
      await observer.resume(dagName, state, cursor, executeOptions);
    } catch (err) {
      this.onError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      await observer.destroy();
      this.#abortController = null;
      this.#isRunning = false;
    }
  }

  #recordConversationTurn(role: ConversationTurn['role'], text: string): ConversationTurn | null {
    const cleanText = ArchivistSession.#messageText(text);
    if (cleanText.length === 0) return null;
    const turn: ConversationTurn = { role, 'text': cleanText, 'ts': this.#clock.now() };
    this.conversation = [...this.conversation, turn];
    this.store.recordConversationTurn(turn);
    this.onMemoryChanged();
    return turn;
  }

  #conversationContextFromMemory(exclude?: ConversationTurn): readonly ConversationTurn[] {
    const turnLimit = this.conversationContextWindow + (exclude === undefined ? 0 : 1);
    return this.store.conversationTurns(turnLimit)
      .filter((t) => exclude === undefined || !ArchivistSession.#sameTurn(t, exclude))
      .slice(-this.conversationContextWindow)
      .map((t) => ({ 'role': t.role, 'text': t.text, 'ts': t.ts }));
  }

  #lastRecordedVisitorTurn(cleanText: string): ConversationTurn | null {
    for (let i = this.conversation.length - 1; i >= 0; i--) {
      const turn = this.conversation[i];
      if (turn !== undefined && turn.role === 'visitor' && turn.text === cleanText) {
        return turn;
      }
    }
    return null;
  }

  static #messageText(value: string): string {
    let text = value.trim();
    let next = ArchivistSession.#stripOneQuotePair(text);
    while (next !== text) {
      text = next.trim();
      next = ArchivistSession.#stripOneQuotePair(text);
    }
    return text;
  }

  static #stripOneQuotePair(value: string): string {
    if (value.length < 2) return value;
    const first = value[0];
    const last = value[value.length - 1];
    const pairs: Readonly<Record<string, string>> = {
      '"':      '"',
      "'":      "'",
      '`':      '`',
      '\u201c': '\u201d',
      '\u2018': '\u2019',
    };
    return first !== undefined && last === pairs[first] ? value.slice(1, -1) : value;
  }

  static #sameTurn(a: ConversationTurn, b: ConversationTurn): boolean {
    return a.role === b.role && a.text === b.text && a.ts === b.ts;
  }

  // ── SessionEventSinkInterface (called by SessionObserver) ─────────────────
  // These methods translate ObservedDag lifecycle events into the structured
  // SessionNodeEvent / SessionDagEvent payloads and route them to the abstract
  // seam methods. They are public because TypeScript cannot restrict access to
  // module-siblings; they are not intended as extension points for consumers.

  pumpFlowStart(dagName: string): void {
    this.onDagEvent({ 'kind': 'flowStart', dagName });
  }

  pumpNodeStart(
    nodeName: string,
    placementPath: readonly string[],
  ): void {
    const fullId = [...placementPath, nodeName].join('/');
    const isTopLevel = placementPath.length === 0;
    const ts = this.#clock.now();
    const trace: SessionTraceEntry | null = isTopLevel
      ? { 'node': fullId, ts, 'variant': 'start', 'output': null, 'message': '' }
      : null;
    this.onNodeEvent({ 'kind': 'nodeStart', 'node': nodeName, fullId, placementPath, 'output': null, trace, ts });
  }

  pumpNodeEnd(
    nodeName: string,
    output: string | null,
    state: ArchivistState,
    placementPath: readonly string[],
  ): void {
    const fullId   = [...placementPath, nodeName].join('/');
    const isInner  = placementPath.length > 0;

    let trace: SessionTraceEntry | null = null;

    if (isInner) {
      // Inner tool-clone nodes: emit a muted 'note' only for tolerated failures.
      if (output === 'error' && state instanceof ToolInvocationState) {
        const lastErr = state.errors[state.errors.length - 1];
        const rawName = lastErr !== undefined ? lastErr.context['toolName'] : undefined;
        const toolName = typeof rawName === 'string' && rawName.length > 0
          ? rawName
          : (placementPath[placementPath.length - 1] ?? nodeName);
        const errMsg      = lastErr !== undefined ? lastErr.message : '';
        const isRateLimit = /429|too many requests/i.test(errMsg);
        const noteMsg     = isRateLimit
          ? `${toolName} · rate-limited · skipped`
          : `${toolName} · unavailable · skipped`;
        trace = { 'node': toolName, 'ts': this.#clock.now(), 'variant': 'note', 'output': null, 'message': noteMsg };
      }
    } else {
      // Top-level nodes: structured end trace row.
      trace = { 'node': fullId, 'ts': this.#clock.now(), 'variant': 'end', output, 'message': '' };

      // Log per-node supplemental summary via the dispatch map.
      if (state instanceof ArchivistState) {
        const supplement = NODE_TRACE_MESSAGES[nodeName]?.(state);
        if (supplement !== undefined) {
          this.logger.info(
            {
              'context': { nodeName },
              'event': 'archivist.node-summary',
              'message': supplement,
              'status': 'complete',
            },
          );
        }
      }
    }

    // StateProjection mirrors the state into the memory graph after every node.
    if (state instanceof ArchivistState) {
      StateProjection.project(state, this.store);
      this.onMemoryChanged();
    }

    this.onNodeEvent({ 'kind': 'nodeEnd', 'node': nodeName, fullId, placementPath, output, trace, 'ts': this.#clock.now() });
  }

  pumpError(
    nodeName: string,
    error: Error,
    placementPath: readonly string[],
  ): void {
    const fullId = [...placementPath, nodeName].join('/');
    const isTopLevel = placementPath.length === 0;
    if (isTopLevel) {
      const msg = error.message !== '' ? error.message : String(error);
      const ts = this.#clock.now();
      this.onNodeEvent({
        'kind': 'nodeEnd',
        'node': nodeName,
        fullId,
        placementPath,
        'output': 'error',
        'trace': { 'node': fullId, ts, 'variant': 'error', 'output': null, 'message': msg },
        ts,
      });
    }
  }

  pumpFlowEnd(
    dagName: string,
    state: ArchivistState,
    result: ExecutionResultType<ArchivistState>,
  ): void {
    const lifecycle = state.lifecycle.variant;

    // Push the archivist turn when the run produced a draft.
    const cleanDraft = ArchivistSession.#messageText(state.draft);
    if (cleanDraft.length > 0) {
      state.draft = cleanDraft;
      const archivistTurn = this.#recordConversationTurn('archivist', cleanDraft);
      if (archivistTurn !== null) this.onArchivistTurn(archivistTurn.text);
    }

    this.logger.result(
      `intent=${state.intent} · shortlist=${String(state.shortlist.length)} · triples=${String(this.store.size)} · lifecycle=${lifecycle}`,
    );

    this.onDagEvent({
      'kind':      'flowEnd',
      dagName,
      lifecycle,
      'draft':     state.draft,
      'cursor':    result.cursor,
      'execution': result,
    });

    this.onRunEnd({
      'kind':      'flowEnd',
      dagName,
      lifecycle,
      'draft':     state.draft,
      'cursor':    result.cursor,
      'execution': result,
    });
  }

  // ── Abstract seam methods ─────────────────────────────────────────────────
  // Subclasses must implement these to connect the session to their view layer.

  /**
   * Called after `boot()` completes backend detection.
   *
   * Vue subclass: assign `backends.value`, set `noModel.value`.
   * DOM subclass: update the backend dropdown DOM.
   * Headless test: capture `backends` and `noModel` for assertion.
   */
  protected abstract onBackendsReady(backends: readonly BackendAvailability[], noModel: boolean): void;

  /**
   * Called when the Archivist greeting is ready (LLM-generated or static).
   *
   * Vue subclass: push to `conversation.value` as an archivist turn.
   * DOM subclass: append a chat bubble.
   * Headless test: record for assertion.
   */
  protected abstract onGreetingReady(greeting: string): void;

  /**
   * Called when a contextual visitor sample reply is ready.
   *
   * Vue subclass: render the seeded visitor turn.
   * DOM subclass: render a visitor bubble.
   * Headless test: record for assertion; assert it differs from the greeting.
   */
  protected abstract onSampleReplyReady(reply: string): void;

  /**
   * Called at the start of `ask()` after the visitor turn is appended to
   * `conversation`. Fires before the DAG begins executing.
   *
   * Vue subclass: nothing (conversation ref already updated by the session).
   * DOM subclass: render a visitor bubble; clear the input.
   * Headless test: record for assertion.
   */
  protected abstract onVisitorTurn(query: string): void;

  /**
   * Called during `pumpFlowEnd` when the run produced a non-empty draft.
   * Fires after the archivist turn is appended to `conversation`.
   *
   * Vue subclass: nothing (conversation ref already updated by the session).
   * DOM subclass: render an archivist bubble.
   * Headless test: record for assertion.
   */
  protected abstract onArchivistTurn(draft: string): void;

  /**
   * Called for every node lifecycle event during a run.
   *
   * Vue subclass: update `trace.value`; call `dagGraph.value?.setActive(fullId)` etc.
   * DOM subclass: log to the console panel.
   * Headless test: collect events in an array.
   */
  protected abstract onNodeEvent(event: SessionNodeEvent): void;

  /**
   * Called at flow start and flow end.
   *
   * Flow-end events carry the full `ExecutionResultType` via `event.execution`,
   * which subclasses use for:
   *   Vue: checkpoint save (read `event.cursor`); lifecycle variant display.
   *   DOM (main.ts): HITL park persist via `Checkpoint.capture` + `IndexedDbCheckpointStore`.
   *   Headless test: assert lifecycle === 'completed'.
   */
  protected abstract onDagEvent(event: SessionDagEvent): void;

  /**
   * Called at flow end. Alias for `onDagEvent({ kind: 'flowEnd', ... })` that
   * carries the same structured payload. Provided as a convenience seam so
   * subclasses that only care about run completion can implement a single method
   * without matching the discriminated-union `kind`.
   *
   * Durability subclass pattern:
   *   - Vue: `if (event.cursor !== null) { saveCheckpoint(); }`
   *   - main.ts: `if (event.execution.parked !== null) { Checkpoint.capture(...).persist(...) }`
   */
  protected abstract onRunEnd(event: Extract<SessionDagEvent, { kind: 'flowEnd' }>): void;

  /**
   * Called after every node completes when the state contains ArchivistState,
   * indicating that the memory store has been updated via StateProjection.
   *
   * Vue subclass: `memoryTick.value++` to trigger MemoryGraph re-render.
   * DOM subclass: no-op (no live memory graph in standalone demo).
   * Headless test: count calls to verify projection ran.
   */
  protected abstract onMemoryChanged(): void;

  /**
   * Called when an unhandled error occurs during `ask()`.
   *
   * Vue subclass: push an error bubble to `conversation.value`.
   * DOM subclass: render an error line.
   * Headless test: record for assertion.
   */
  protected abstract onError(error: Error): void;

  /**
   * Called at the start of `reset()` before conversation and store are cleared.
   * Override to reload a seed library, reload the ontology, etc.
   *
   * Default: no-op.
   */
  protected onReset(): void {
    // no-op default; subclasses may override to reload ontology / seed data
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  #resolveLlm(): LlmClientInterface | null {
    if (this.#injectedLlm !== null) return this.#injectedLlm;
    if (this.activeBackend === null) return null;
    const preferred = this.preferredModels[this.activeBackend];
    const model = typeof preferred === 'string' && preferred.length > 0
      ? preferred
      : (this.backends.find((b) => b.id === this.activeBackend)?.resolvedModel ?? '');
    return ProviderInstantiator.instantiate(this.activeBackend, {
      'apiKeys':  this.apiKeys,
      'model':    model,
      'language': this.visitorLanguage,
      ...(this.#onWebLlmProgress !== null ? { 'onWebLlmProgress': this.#onWebLlmProgress } : {}),
      ...(this.intentClassifier !== null ? { 'intentClassifier': this.intentClassifier } : {}),
    });
  }

  #generateRunId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
    return `r-${String(this.#clock.now())}-${String(Math.floor(Math.random() * 1e6))}`;
  }

  static #loadSavedBackend(): ProviderId | null {
    return ActiveBackendStore.load();
  }

  #staticGreeting(): string {
    const pool = STATIC_GREETINGS;
    return pool[this.#clock.now() % pool.length] ?? pool[0] ?? '';
  }

  #staticVisitorReply(): string {
    const pool = STATIC_VISITOR_REPLIES;
    return pool[this.#clock.now() % pool.length] ?? pool[0] ?? '';
  }
}
