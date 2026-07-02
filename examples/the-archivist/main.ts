/**
 * main.ts: browser entrypoint for the standalone Archivist demo.
 *
 * Builds and wires a `DomArchivistSession` — the DOM subclass of the shared
 * `ArchivistSession` base — then runs the same greeting → sample-reply
 * bootstrap as the advanced docs demo. Distinctive features retained:
 *
 *   LlmAdapterCascade: browser adapters in preference order
 *     GeminiNano → WebLLM → GeminiAPI (?apiKey=) → Ollama (local)
 *
 *   IndexedDB durability: memory n-quads persisted after every completed run;
 *     restored on page load so the Archivist remembers past conversations.
 *
 *   HITL park / reload / resume: when ParkForInputNode parks the flow, the
 *     checkpoint is persisted and a banner prompts the visitor for a reply.
 *     Resuming restores the checkpoint and continues the parked DAG.
 *
 *   URL params:
 *     ?apiKey=<key>        Gemini API key for the REST adapter fallback.
 *     ?lang=<tag>          Override browser language detection (e.g. ?lang=fr).
 *     ?park                Skip auto-run; park immediately on load.
 *     ?webLlmModel=<id>    Override the WebLLM prebuilt model.
 *
 * Ollama CORS caveat: start the daemon with
 * `OLLAMA_ORIGINS='http://localhost:5174' ollama serve` (or `OLLAMA_ORIGINS='*'`)
 * to allow cross-origin requests from this harness.
 */

import { GeminiApiAdapter }  from '@studnicky/dagonizer-adapter-gemini-api';
import { GeminiNanoAdapter } from '@studnicky/dagonizer-adapter-gemini-nano';
import { OllamaApiAdapter }  from '@studnicky/dagonizer-adapter-ollama';
import { WebLlmAdapter }     from '@studnicky/dagonizer-adapter-web-llm';
import type { WebLlmInitReportType } from '@studnicky/dagonizer-adapter-web-llm';
import { LlmAdapterCascade, LlmAdapterRegistry } from '@studnicky/dagonizer/adapter';
import type { AdapterCapabilitiesType } from '@studnicky/dagonizer/adapter';
import type { DAGType } from '@studnicky/dagonizer';
import { IndexedDbCheckpointStore, IndexedDbStore } from '@studnicky/dagonizer-store-indexeddb';

import { DomArchivistSession } from './DomArchivistSession.ts';
import { UserLanguage } from './language/UserLanguage.ts';
import { DomConsoleLogger } from './logger/DomConsoleLogger.ts';
import { MemoryStore } from './memory/MemoryStore.ts';
import { BaseLlmClient } from './providers/BaseLlmClient.ts';
import { prompts } from './providers/prompts.ts';
import { ArchivistBundleFactory } from './dag.ts';
import { BookSearchScatterBundleFactory } from './embedded-dags/BookSearchScatterDAG.ts';
import { ComposeRetryLoopBundleFactory } from './embedded-dags/ComposeRetryLoopDAG.ts';
import { ArchivistNodes } from './nodes/ArchivistNodes.ts';
import { ArchivistGraph } from './viz/ArchivistGraph.ts';

// ── DOM element acquisition ───────────────────────────────────────────────────

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

// Hide HITL banner until a parked flow is detected.
hitlBanner.style.display = 'none';

// ── Static helpers for DAG visualization pane ─────────────────────────────────

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

// ── URL params ────────────────────────────────────────────────────────────────

const params      = new URLSearchParams(window.location.search);
const urlApiKey   = params.get('apiKey') ?? '';
const urlLang     = params.get('lang') ?? '';
const urlWebLlmModel = params.get('webLlmModel') ?? 'Phi-3.5-mini-instruct-q4f16_1-MLC';

// ── Logger ────────────────────────────────────────────────────────────────────

const logger = new DomConsoleLogger({ 'panel': logEl });

// ── Visitor device language ───────────────────────────────────────────────────

const userLanguage = urlLang.length > 0
  ? UserLanguage.normalize(urlLang)
  : UserLanguage.detect();
logger.note(`language: ${userLanguage} (${UserLanguage.displayName(userLanguage)})`);

// ── IndexedDB stores ──────────────────────────────────────────────────────────

const kvStore   = IndexedDbStore.open();
const ckptStore = IndexedDbCheckpointStore.open();
await kvStore.connect();
await ckptStore.connect();

// ── Cascade: browser-runnable adapters in preference order ────────────────────

const CAPS_FULL_TOOLS:    AdapterCapabilitiesType = { 'toolUse': 'full',    'structuredOutput': true, 'jsonMode': true };
const CAPS_PARTIAL_TOOLS: AdapterCapabilitiesType = { 'toolUse': 'partial', 'structuredOutput': true, 'jsonMode': true };
const CAPS_NO_TOOLS:      AdapterCapabilitiesType = { 'toolUse': 'none',    'structuredOutput': true, 'jsonMode': false };

const registry = new LlmAdapterRegistry();

// On-device first: GeminiNano (flag-gated on older Chrome/Edge).
const geminiNanoAdapter = new GeminiNanoAdapter({ 'systemPrompt': prompts.systemPrompt() });
const geminiNanoModel   = await geminiNanoAdapter.selectChatModel();
if (geminiNanoModel !== null) {
  registry.register(
    { 'provider': 'gemini-nano', 'model': geminiNanoModel, 'capabilities': CAPS_NO_TOOLS },
    () => geminiNanoAdapter,
  );
}

// WebGPU-accelerated in-browser model. Progress logged via subclass seam.
class LoggingWebLlmAdapter extends WebLlmAdapter {
  protected override onInitProgress(report: WebLlmInitReportType): void {
    logger.note(`web-llm: ${report.text} (${String(Math.round(report.progress * 100))}%)`);
  }
}

const loggingWebLlmAdapter = new LoggingWebLlmAdapter({ 'systemPrompt': prompts.systemPrompt() });
const webLlmModel = await loggingWebLlmAdapter.selectChatModel({ 'preferred': urlWebLlmModel });
if (webLlmModel !== null) {
  registry.register(
    { 'provider': 'web-llm', 'model': webLlmModel, 'capabilities': CAPS_PARTIAL_TOOLS },
    () => loggingWebLlmAdapter,
  );
}

// REST fallback: registered only when ?apiKey= is supplied.
if (urlApiKey.length > 0) {
  const geminiApiAdapter = new GeminiApiAdapter(urlApiKey, { 'systemPrompt': prompts.systemPrompt() });
  const geminiApiModel   = await geminiApiAdapter.selectChatModel();
  if (geminiApiModel !== null) {
    registry.register(
      { 'provider': 'gemini-api', 'model': geminiApiModel, 'capabilities': CAPS_FULL_TOOLS },
      () => geminiApiAdapter,
    );
  }
}

// Ollama: only reachable when the daemon runs locally with CORS enabled.
const ollamaAdapter = new OllamaApiAdapter({ 'baseUrl': 'http://127.0.0.1:11434', 'systemPrompt': prompts.systemPrompt() });
const ollamaModel   = await ollamaAdapter.selectChatModel();
if (ollamaModel !== null) {
  registry.register(
    { 'provider': 'ollama', 'model': ollamaModel, 'capabilities': CAPS_PARTIAL_TOOLS },
    () => ollamaAdapter,
  );
}

const cascade = new LlmAdapterCascade(registry, registry.list().map((entry) => ({
  'provider': entry.provider,
  'model':    entry.model,
})));

// Select the best available adapter. If none is reachable, disable the form
// and surface the error; the page stays up so the visitor can try again.
let adapter;
try {
  adapter = await cascade.select();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  const line = document.createElement('span');
  line.className = 'error';
  line.textContent = `[error] ${message}\n`;
  logEl.appendChild(line);
  button.disabled = true;
  input.disabled  = true;
  throw err;
}

// ── Memory store + persisted n-quads restore ──────────────────────────────────

const store = new MemoryStore();

const storedNquads = await kvStore.get('memory:nquads');
if (typeof storedNquads === 'string' && storedNquads.length > 0) {
  await store.restore({
    'version': 1,
    'type':    'archivist-memory-v1',
    'entries': [{ 'key': 'nquads', 'value': storedNquads }],
  });
  logger.note(`memory: restored ${String(store.size)} quads from IndexedDB`);
}

// ── LLM client (LlmAdapterCascade result → BaseLlmClient) ────────────────────
// EmbedderProvisioner is called once inside `session.boot()` — no duplicate here.

const llm = new BaseLlmClient(adapter, { 'language': userLanguage });
logger.note(`backend: ${adapter.id} (${adapter.displayName})`);

// ── DomArchivistSession ───────────────────────────────────────────────────────

const session = new DomArchivistSession(store, logger, {
  'llm': llm,
  'visitorLanguage': userLanguage,
  'dom': { button, input, logEl, conversationEl, hitlBanner, hitlInput, hitlResumeButton },
  'stores': { kvStore, ckptStore },
});

// ── DAG visualization: build DAG objects for DagPane ─────────────────────────
// Build dummy rig just to get the DAG definitions for the viz. The session
// uses its own rig for actual execution; this read-only path only needs the
// bundle DAG objects (no HTTP calls, no embedder).

{
  const dummyNodes = ArchivistNodes.build({
    'webSearch':        { 'definition': { 'name': 'web_search_books', 'description': '', 'inputSchema': { 'type': 'object' as const }, 'outputSchema': { 'type': 'object' as const }, 'strict': false }, async execute() { return []; } },
    'googleBooks':      { 'definition': { 'name': 'google_books_search', 'description': '', 'inputSchema': { 'type': 'object' as const }, 'outputSchema': { 'type': 'object' as const }, 'strict': false }, async execute() { return []; } },
    'subjectSearch':    { 'definition': { 'name': 'subject_search', 'description': '', 'inputSchema': { 'type': 'object' as const }, 'outputSchema': { 'type': 'object' as const }, 'strict': false }, async execute() { return []; } },
    'wikipediaSummary': { 'definition': { 'name': 'wikipedia_summary', 'description': '', 'inputSchema': { 'type': 'object' as const }, 'outputSchema': { 'type': 'object' as const }, 'strict': false }, async execute() { return []; } },
    'llm':              llm,
    'memory':           store,
    'embedder':         null,
    'nodeTimeouts':     {},
  });
  const bookSearchBundle  = BookSearchScatterBundleFactory.create(dummyNodes);
  const composeBundle     = ComposeRetryLoopBundleFactory.create(dummyNodes);
  const parentBundle      = ArchivistBundleFactory.create(dummyNodes);
  const archivistDAG      = parentBundle.dags[0];
  const bookSearchDAG     = bookSearchBundle.dags[0];
  const composeDAG        = composeBundle.dags[0];
  if (archivistDAG !== undefined && bookSearchDAG !== undefined && composeDAG !== undefined) {
    DagPane.mount(dagContainerEl, archivistDAG, bookSearchDAG, composeDAG);
  }
}

// ── Restore pending HITL state (survives page reload) ────────────────────────

const pendingKey    = await kvStore.get('hitl:pendingKey');
const hasPendingHitl = typeof pendingKey === 'string' && pendingKey.length > 0;
if (hasPendingHitl) {
  logger.note(`hitl: pending resume for correlation key '${String(pendingKey)}'`);
  hitlBanner.style.display = 'flex';
}

// ── Event wiring ──────────────────────────────────────────────────────────────

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const query = input.value.trim();
  if (query.length === 0) return;
  button.disabled = true;
  void session.ask(query);
});

hitlResumeButton.addEventListener('click', () => {
  const humanText = hitlInput.value.trim();
  if (humanText.length === 0) return;
  void session.resumeHitl(humanText);
});

// ── Bootstrap: boot → greet → sampleReply ────────────────────────────────────
// Mirrors the advanced docs demo. On pending HITL, skip the fresh greeting so
// the visitor can resume the parked flow without triggering a competing run.
// On ?park, start parked immediately.

await session.boot();

if (!hasPendingHitl) {
  if (params.has('park')) {
    void session.ask('');
  } else {
    const greeting = await session.greet();
    await session.sampleReply(greeting);
  }
}
