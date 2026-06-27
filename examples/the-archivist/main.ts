/**
 * main.ts: browser entrypoint for the Archivist demo.
 *
 * Mirrors `runArchivist.ts`'s setup but composes a browser-runnable
 * cascade and streams the logger to the DOM. Default preference:
 *
 *   Browser built-in LanguageModel (flag-gated on older Chrome/Edge)
 *     →  WebLLM      (any WebGPU browser; ~700 MB model download on first use)
 *     →  Gemini API  (REST; key supplied via `?apiKey=…` URL param)
 *     →  Ollama      (only when running locally with CORS enabled; see below)
 *
 * Ollama CORS caveat: by default the daemon refuses cross-origin
 * requests. To use Ollama from this harness, start it with
 * `OLLAMA_ORIGINS='http://localhost:5174' ollama serve` (or
 * `OLLAMA_ORIGINS='*'` for any localhost dev server). Without that the
 * probe will surface as `probe failed` and the cascade routes around it.
 *
 * If no adapter is reachable, `cascade.select()` throws and the
 * verbatim error message renders in the log panel.
 *
 * IndexedDB durability:
 *   After each completed run the RDF memory graph is persisted to
 *   `IndexedDbStore` under `'memory:nquads'`. On page load the graph is
 *   restored before the first run, giving the Archivist continuity across
 *   reloads.
 *
 * HITL (human-in-the-loop) park/reload/resume:
 *   When `ParkForInputNode` parks the flow (empty query), the checkpoint is
 *   persisted via `IndexedDbCheckpointStore` and the correlationKey is written
 *   to `'hitl:pendingKey'`. A HITL banner appears so the visitor can type a
 *   reply and resume the parked flow via `dispatcher.resume()`.
 */

import { ArchivistState } from './ArchivistState.ts';
import { ArchivistNodes } from './nodes/ArchivistNodes.ts';
import { ArchivistBundleFactory } from './dag.ts';
import { UserLanguage } from './language/UserLanguage.ts';
import { BookSearchScatterBundleFactory } from './embedded-dags/BookSearchScatterDAG.ts';
import { ComposeRetryLoopBundleFactory } from './embedded-dags/ComposeRetryLoopDAG.ts';
import { DomConsoleLogger } from './logger/DomConsoleLogger.ts';
import { MemoryStore } from './memory/MemoryStore.ts';
import { ObservedDag } from './ObservedDag.ts';
import { BaseLlmClient } from './providers/BaseLlmClient.ts';
import { EmbedderProvisioner } from './providers/EmbedderProvisioner.ts';
import { prompts } from './providers/prompts.ts';
import type { ArchivistServices, LlmClientInterface } from './services.ts';
import { ArchivistGraph } from './viz/ArchivistGraph.ts';

import { GeminiApiAdapter }   from '@studnicky/dagonizer-adapter-gemini-api';
import { GeminiNanoAdapter }  from '@studnicky/dagonizer-adapter-gemini-nano';
import { OllamaApiAdapter }   from '@studnicky/dagonizer-adapter-ollama';
import { WebLlmAdapter }      from '@studnicky/dagonizer-adapter-web-llm';
import type { WebLlmInitReportType } from '@studnicky/dagonizer-adapter-web-llm';

import { LlmAdapterCascade, LlmAdapterRegistry } from '@studnicky/dagonizer/adapter';
import type { AdapterCapabilitiesType } from '@studnicky/dagonizer/adapter';

import { GoogleBooksTool }       from '@studnicky/dagonizer-tool-googlebooks';
import { OpenLibrarySearchTool, SubjectSearchTool } from '@studnicky/dagonizer-tool-openlibrary';
import { WikipediaSummaryTool }  from '@studnicky/dagonizer-tool-wikipedia';
import { ToolRegistry } from '@studnicky/dagonizer/tool';

import type { DAGType } from '@studnicky/dagonizer';

import { IndexedDbStore, IndexedDbCheckpointStore } from '@studnicky/dagonizer-store-indexeddb';
import { Checkpoint, CheckpointRestoreAdapter } from '@studnicky/dagonizer/checkpoint';

// ── DOM ──────────────────────────────────────────────────────────────────
const formEl = document.getElementById('ask-form');
if (!(formEl instanceof HTMLFormElement))    throw new Error('missing #ask-form');
const form = formEl;

const inputEl = document.getElementById('ask-input');
if (!(inputEl instanceof HTMLInputElement))  throw new Error('missing #ask-input');
const input = inputEl;

const buttonEl = document.getElementById('ask-button');
if (!(buttonEl instanceof HTMLButtonElement)) throw new Error('missing #ask-button');
const button = buttonEl;

const logRaw = document.getElementById('archivist-log');
if (!(logRaw instanceof HTMLPreElement))     throw new Error('missing #archivist-log');
const logEl = logRaw;

const hitlBannerEl = document.getElementById('hitl-banner');
if (!(hitlBannerEl instanceof HTMLDivElement)) throw new Error('missing #hitl-banner');
const hitlBanner = hitlBannerEl;

const hitlInputEl = document.getElementById('hitl-input');
if (!(hitlInputEl instanceof HTMLInputElement)) throw new Error('missing #hitl-input');
const hitlInput = hitlInputEl;

const hitlResumeEl = document.getElementById('hitl-resume');
if (!(hitlResumeEl instanceof HTMLButtonElement)) throw new Error('missing #hitl-resume');
const hitlResumeButton = hitlResumeEl;

const conversationRaw = document.getElementById('conversation');
if (!(conversationRaw instanceof HTMLDivElement)) throw new Error('missing #conversation');
const conversationEl = conversationRaw;

const dagContainerRaw = document.getElementById('dag-container');
if (!(dagContainerRaw instanceof HTMLDivElement)) throw new Error('missing #dag-container');
const dagContainerEl = dagContainerRaw;

// Hide banner initially.
hitlBanner.style.display = 'none';

/** Static factory for conversation chat bubble DOM elements. */
class ChatBubble {
  static visitor(text: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'bubble bubble-visitor';
    el.textContent = text;
    return el;
  }

  static archivist(text: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'bubble bubble-archivist';
    el.textContent = text;
    return el;
  }
}

/** Static helpers for the conversation panel: push bubbles and scroll. */
class ConversationView {
  static pushVisitor(container: HTMLDivElement, text: string): void {
    container.appendChild(ChatBubble.visitor(text));
    container.scrollTop = container.scrollHeight;
  }

  static pushArchivist(container: HTMLDivElement, text: string): void {
    container.appendChild(ChatBubble.archivist(text));
    container.scrollTop = container.scrollHeight;
  }
}

/** Static helpers for the DAG visualization pane: mount an ArchivistGraph. */
class DagPane {
  static mount(
    container: HTMLDivElement,
    archivistDAG: DAGType,
    bookSearchDAG: DAGType,
    composeDAG: DAGType,
  ): void {
    const embeddedDAGs = new Map<string, DAGType>([
      ['book-search-scatter', bookSearchDAG],
      ['compose-retry-loop',  composeDAG],
    ]);
    void new ArchivistGraph(container, archivistDAG, { embeddedDAGs }).mount();
  }
}

/** Static CLI helpers for the browser demo: log wiring, query submission, and HITL resume. */
class ArchivistCli {
  static appendErrorLine(message: string): void {
    const line = document.createElement('span');
    line.className = 'error';
    line.textContent = `[error] ${message}\n`;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  static async ask(query: string): Promise<void> {
    if (query.length > 0) {
      ConversationView.pushVisitor(conversationEl, query);
    }
    const visitor = new ArchivistState();
    visitor.query = query;
    button.disabled = true;
    try {
      const execution = dispatcher.execute('the-archivist', visitor);
      for await (const stage of execution) {
        logger.info(`▸ ${stage.nodeName}${stage.skipped ? ' (skipped)' : ` → ${stage.output ?? '(none)'}`}`);
      }
      const result = await execution;
      logger.result(`intent=${result.state.intent}`);
      logger.result(`shortlist=${String(result.state.shortlist.length)}`);
      logger.result(`draft=${result.state.draft}`);
      logger.result(`lifecycle=${result.state.lifecycle.variant}`);

      if (result.parked !== null) {
        // Flow parked — persist checkpoint and show the HITL banner.
        const ckpt = await Checkpoint.capture('the-archivist', result, { 'stores': { 'memory': memory } });
        await ckpt.persist(ckptStore, result.parked.correlationKey);
        await kvStore.set('hitl:pendingKey', result.parked.correlationKey);
        hitlBanner.style.display = 'flex';
      } else {
        // Completed run — push the archivist bubble, persist memory graph.
        if (result.state.draft.length > 0) {
          ConversationView.pushArchivist(conversationEl, result.state.draft);
        }
        const snap = await memory.snapshot();
        const nquadsEntry = snap.entries.find((e) => e.key === 'nquads');
        if (typeof nquadsEntry?.value === 'string') {
          await kvStore.set('memory:nquads', nquadsEntry.value);
        }
        await kvStore.delete('hitl:pendingKey');
        hitlBanner.style.display = 'none';
      }
    } catch (err) {
      ArchivistCli.appendErrorLine(err instanceof Error ? err.message : String(err));
    } finally {
      button.disabled = false;
    }
  }

  static async resume(humanText: string): Promise<void> {
    ConversationView.pushVisitor(conversationEl, humanText);
    hitlResumeButton.disabled = true;
    try {
      const pendingKey = await kvStore.get('hitl:pendingKey');
      if (typeof pendingKey !== 'string' || pendingKey.length === 0) {
        ArchivistCli.appendErrorLine('No pending HITL checkpoint found.');
        return;
      }
      const recalled = await Checkpoint.recall(ckptStore, pendingKey);
      if (recalled === null) {
        ArchivistCli.appendErrorLine(`Checkpoint '${pendingKey}' not found in store.`);
        return;
      }
      await recalled.restoreStores({ 'memory': memory });
      const { dagName, state, cursor } = recalled.restoreState(
        CheckpointRestoreAdapter.wrap((snap) => ArchivistState.restore(snap)),
      );
      state.query = humanText;

      const execution = dispatcher.resume(dagName, state, cursor);
      for await (const stage of execution) {
        logger.info(`▸ ${stage.nodeName}${stage.skipped ? ' (skipped)' : ` → ${stage.output ?? '(none)'}`}`);
      }
      const result = await execution;
      logger.result(`intent=${result.state.intent}`);
      logger.result(`shortlist=${String(result.state.shortlist.length)}`);
      logger.result(`draft=${result.state.draft}`);
      logger.result(`lifecycle=${result.state.lifecycle.variant}`);

      // Push archivist bubble after successful resume.
      if (result.state.draft.length > 0) {
        ConversationView.pushArchivist(conversationEl, result.state.draft);
      }

      // Persist memory graph after successful resume; clear pending key.
      const snap = await memory.snapshot();
      const nquadsEntry = snap.entries.find((e) => e.key === 'nquads');
      if (typeof nquadsEntry?.value === 'string') {
        await kvStore.set('memory:nquads', nquadsEntry.value);
      }
      await kvStore.delete('hitl:pendingKey');
      hitlBanner.style.display = 'none';
      hitlInput.value = '';
    } catch (err) {
      ArchivistCli.appendErrorLine(err instanceof Error ? err.message : String(err));
    } finally {
      hitlResumeButton.disabled = false;
    }
  }
}

// ── Logger wiring: DomConsoleLogger streams every event to the <pre> via
//    its onEmit override (no subscribe callback). ──────────────────────────
const logger = new DomConsoleLogger({ 'panel': logEl });

// ── IndexedDB stores ──────────────────────────────────────────────────────
const kvStore   = IndexedDbStore.open();
const ckptStore = IndexedDbCheckpointStore.open();
await kvStore.connect();
await ckptStore.connect();

// ── Cascade: browser-runnable adapters in preference order. ──────────────
const CAPS_FULL_TOOLS:    AdapterCapabilitiesType = { 'toolUse': 'full',    'structuredOutput': true, 'jsonMode': true };
const CAPS_PARTIAL_TOOLS: AdapterCapabilitiesType = { 'toolUse': 'partial', 'structuredOutput': true, 'jsonMode': true };
const CAPS_NO_TOOLS:      AdapterCapabilitiesType = { 'toolUse': 'none',    'structuredOutput': true, 'jsonMode': false };

const params = new URLSearchParams(window.location.search);
const urlApiKey = params.get('apiKey') ?? '';

// Visitor device language: URL `?lang=` overrides browser detection.
const urlLang = params.get('lang') ?? '';
const userLanguage = urlLang.length > 0
  ? UserLanguage.normalize(urlLang)
  : UserLanguage.detect();
logger.info(`language: ${userLanguage} (${UserLanguage.displayName(userLanguage)})`);

const registry = new LlmAdapterRegistry();

// On-device first. The model name is discovered via the adapter instance
// contract: `selectChatModel()` resolves the single on-device descriptor
// ('gemini-nano'); no cosmetic placeholder literal at the registration site.
const geminiNanoAdapter = new GeminiNanoAdapter({ 'systemPrompt': prompts.systemPrompt() });
const geminiNanoModel = await geminiNanoAdapter.selectChatModel();
if (geminiNanoModel !== null) {
  registry.register(
    { 'provider': 'gemini-nano', 'model': geminiNanoModel, 'capabilities': CAPS_NO_TOOLS },
    () => geminiNanoAdapter,
  );
}

// WebGPU-accelerated in-browser model. Lazy-downloads on first chat.
// Progress reporting is an extension seam: subclass and override
// onInitProgress rather than passing a callback in.
class LoggingWebLlmAdapter extends WebLlmAdapter {
  protected override onInitProgress(report: WebLlmInitReportType): void {
    logger.info(`web-llm: ${report.text} (${String(Math.round(report.progress * 100))}%)`);
  }
}
// Model resolution via the adapter instance contract: `selectChatModel`
// reads web-llm's static prebuilt catalog. The visitor's `WEB_LLM_MODEL`
// URL param picks a specific prebuilt model when supplied; otherwise the
// demo prefers the Phi-3.5 mini build the adapter is documented around.
const loggingWebLlmAdapter = new LoggingWebLlmAdapter({ 'systemPrompt': prompts.systemPrompt() });
const webLlmModel = await loggingWebLlmAdapter.selectChatModel({
  'preferred': params.get('webLlmModel') ?? 'Phi-3.5-mini-instruct-q4f16_1-MLC',
});
if (webLlmModel !== null) {
  registry.register(
    { 'provider': 'web-llm', 'model': webLlmModel, 'capabilities': CAPS_PARTIAL_TOOLS },
    () => loggingWebLlmAdapter,
  );
}

// REST fallback: registered only when a key is supplied via the `?apiKey=`
// URL param. A blocking `window.prompt()` is never issued — a modal dialog
// stalls the renderer (and any driving automation) before an available
// on-device adapter is even tried. Model is discovered via `selectChatModel`
// so the adapter always uses a model the provider actually serves.
if (urlApiKey.length > 0) {
  const geminiApiAdapter = new GeminiApiAdapter(urlApiKey, { 'systemPrompt': prompts.systemPrompt() });
  const geminiApiModel = await geminiApiAdapter.selectChatModel();
  if (geminiApiModel !== null) {
    registry.register(
      { 'provider': 'gemini-api', 'model': geminiApiModel, 'capabilities': CAPS_FULL_TOOLS },
      () => geminiApiAdapter,
    );
  }
}

// Ollama: only useful when the daemon is running locally with CORS
// allowed (see the file-level comment). The model is discovered via the
// adapter instance contract: `selectChatModel` calls `GET /api/tags` and
// picks the best available chat model. Ollama is skipped entirely when no
// chat model is installed, so the cascade never falls into a "model not
// found" loop.
const ollamaAdapter = new OllamaApiAdapter({ 'baseUrl': 'http://127.0.0.1:11434', 'systemPrompt': prompts.systemPrompt() });
const ollamaModel = await ollamaAdapter.selectChatModel();
if (ollamaModel !== null) {
  registry.register(
    { 'provider': 'ollama', 'model': ollamaModel, 'capabilities': CAPS_PARTIAL_TOOLS },
    () => ollamaAdapter,
  );
}

const cascade = new LlmAdapterCascade(registry, registry.list().map((entry) => ({
  'provider': entry.provider,
  'model': entry.model,
})));

let llm: LlmClientInterface;
try {
  const adapter = await cascade.select();
  const { embedder, intentClassifier } = await EmbedderProvisioner.provision();
  if (embedder !== null) {
    logger.info(`embedder: ${embedder.id} (${embedder.displayName})`);
  } else {
    logger.info('embedder: none available; intent classification via LLM only');
  }
  llm = new BaseLlmClient(adapter, {
    'language': userLanguage,
    ...(intentClassifier !== null ? { 'intentClassifier': intentClassifier } : {}),
  });
  logger.info(`backend: ${adapter.id} (${adapter.displayName})`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  ArchivistCli.appendErrorLine(message);
  button.disabled = true;
  input.disabled = true;
  throw err;
}

// #region wire-services
// ── Dispatcher + DAG registration (mirrors runArchivist.ts). ─────────────
const { embedder } = await EmbedderProvisioner.provision();
const memory = new MemoryStore();
const services: ArchivistServices = {
  'webSearch':        new OpenLibrarySearchTool(),
  'googleBooks':      new GoogleBooksTool(),
  'subjectSearch':    new SubjectSearchTool(),
  'wikipediaSummary': new WikipediaSummaryTool(),
  'memory':           memory,
  'llm':              llm,
  // Browser embedder provisioned when available (transformers → tensorflow →
  // web-llm). Cosine recall and hybrid ranking fall back to Jaccard /
  // heuristics when no embedder is reachable.
  'embedder':         embedder,
  'nodeTimeouts':     {},
};

// Restore persisted memory graph from IndexedDB if present.
const storedNquads = await kvStore.get('memory:nquads');
if (typeof storedNquads === 'string' && storedNquads.length > 0) {
  await memory.restore({
    'version': 1,
    'type':    'archivist-memory-v1',
    'entries': [{ 'key': 'nquads', 'value': storedNquads }],
  });
  logger.info(`memory: restored ${String(memory.size)} quads from IndexedDB`);
}

// ObservedDag: generic Dagonizer subclass wiring every lifecycle hook to an
// injected logger. The DOM driver's `DomConsoleLogger` is passed in so the
// dispatcher's hook log lines stream into the `<pre>` panel alongside the
// driver's own stage / result lines.
const dispatcher = new ObservedDag<ArchivistState>(logger);
// #endregion wire-services

// #region register-bundle
// Tool registry: each book-search tool becomes an embeddable `tool:<name>` DAG.
// Register before BookSearchScatterBundleFactory so the embedded-DAG references resolve.
const toolRegistry = new ToolRegistry();
toolRegistry.register(new OpenLibrarySearchTool());
toolRegistry.register(new GoogleBooksTool());
toolRegistry.register(new SubjectSearchTool());
toolRegistry.register(new WikipediaSummaryTool());
dispatcher.registerBundle(toolRegistry.bundle());

// Construct every services-injected node exactly once; the shared set is
// passed to all three factories so duplicate registrations refer to identical
// instances and the registrar accepts them.
const nodes = ArchivistNodes.build(services);
const bookSearchBundle = BookSearchScatterBundleFactory.create(nodes);
const composeBundle    = ComposeRetryLoopBundleFactory.create(nodes);
const parentBundle     = ArchivistBundleFactory.create(nodes);

dispatcher.registerBundle(bookSearchBundle);
dispatcher.registerBundle(composeBundle);
dispatcher.registerBundle(parentBundle);
// #endregion register-bundle

// ── DAG visualization: mount ArchivistGraph into the right pane. ─────────
const archivistDAG  = parentBundle.dags[0];
const bookSearchDAG = bookSearchBundle.dags[0];
const composeDAG    = composeBundle.dags[0];
if (archivistDAG !== undefined && bookSearchDAG !== undefined && composeDAG !== undefined) {
  DagPane.mount(dagContainerEl, archivistDAG, bookSearchDAG, composeDAG);
}

// ── Restore pending HITL state (survives page reload). ───────────────────
const pendingKey = await kvStore.get('hitl:pendingKey');
const hasPendingHitl = typeof pendingKey === 'string' && pendingKey.length > 0;
if (hasPendingHitl) {
  logger.info(`hitl: pending resume for correlation key '${String(pendingKey)}'`);
  hitlBanner.style.display = 'flex';
}

// #region run-loop
// ── Submit handler: fresh state per ask. ──────────────────────────────────
form.addEventListener('submit', (event) => {
  event.preventDefault();
  const query = input.value.trim();
  if (query.length === 0) return;
  void ArchivistCli.ask(query);
});

// ── HITL resume handler. ───────────────────────────────────────────────────
hitlResumeButton.addEventListener('click', () => {
  const humanText = hitlInput.value.trim();
  if (humanText.length === 0) return;
  void ArchivistCli.resume(humanText);
});

// First-load behavior:
//   • A pending HITL resume always wins — never start a fresh run on top of a
//     parked flow; the visitor's reply is owed to the parked DAG.
//   • `?park` starts a parked session that waits for the visitor's first
//     question (showcases HITL park / reload / resume durability).
//   • Otherwise the demo auto-runs the seed question so the page "just works".
const SEED_QUERY = "I'm looking for a book about a strange house and a library";
if (!hasPendingHitl) {
  if (params.has('park')) {
    void ArchivistCli.ask('');
  } else {
    input.value = SEED_QUERY;
    void ArchivistCli.ask(SEED_QUERY);
  }
}
// #endregion run-loop
