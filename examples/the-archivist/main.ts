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
 */

import { ArchivistState } from './ArchivistState.ts';
import { ArchivistNodes } from './nodes/ArchivistNodes.ts';
import { ArchivistBundleFactory } from './dag.ts';
import { UserLanguage } from './language/UserLanguage.ts';
import { BookSearchScatterBundleFactory } from './embedded-dags/BookSearchScatterDAG.ts';
import { ComposeRetryLoopBundleFactory } from './embedded-dags/ComposeRetryLoopDAG.ts';
import { DomConsoleLogger } from './logger/DomConsoleLogger.ts';
import { MemoryStore } from './memory/MemoryStore.ts';
import { ObservedArchivist } from './ObservedArchivist.ts';
import { BaseLlmClient } from './providers/BaseLlmClient.ts';
import type { ArchivistServices, LlmClientInterface } from './services.ts';

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

/** Static CLI helpers for the browser demo: log wiring and query submission. */
class ArchivistCli {
  static appendErrorLine(message: string): void {
    const line = document.createElement('span');
    line.className = 'error';
    line.textContent = `[error] ${message}\n`;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  static async ask(query: string): Promise<void> {
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
    } catch (err) {
      ArchivistCli.appendErrorLine(err instanceof Error ? err.message : String(err));
    } finally {
      button.disabled = false;
    }
  }
}

// ── Logger wiring: DomConsoleLogger streams every event to the <pre> via
//    its onEmit override (no subscribe callback). ──────────────────────────
const logger = new DomConsoleLogger({ 'panel': logEl });

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
const geminiNanoAdapter = new GeminiNanoAdapter();
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
const loggingWebLlmAdapter = new LoggingWebLlmAdapter();
const webLlmModel = await loggingWebLlmAdapter.selectChatModel({
  'preferred': params.get('webLlmModel') ?? 'Phi-3.5-mini-instruct-q4f16_1-MLC',
});
if (webLlmModel !== null) {
  registry.register(
    { 'provider': 'web-llm', 'model': webLlmModel, 'capabilities': CAPS_PARTIAL_TOOLS },
    () => loggingWebLlmAdapter,
  );
}

// REST fallback: key from URL param, otherwise prompt the visitor.
// Model is discovered via `selectChatModel` so the adapter always uses a
// model the provider actually serves; no hardcoded model literal at the
// registration site.
const geminiApiAdapter = new GeminiApiAdapter(
  urlApiKey.length > 0 ? urlApiKey : (window.prompt('Gemini API key (AI Studio):') ?? ''),
);
const geminiApiModel = await geminiApiAdapter.selectChatModel();
if (geminiApiModel !== null) {
  registry.register(
    { 'provider': 'gemini-api', 'model': geminiApiModel, 'capabilities': CAPS_FULL_TOOLS },
    () => geminiApiAdapter,
  );
}

// Ollama: only useful when the daemon is running locally with CORS
// allowed (see the file-level comment). The model is discovered via the
// adapter instance contract: `selectChatModel` calls `GET /api/tags` and
// picks the best available chat model. Ollama is skipped entirely when no
// chat model is installed, so the cascade never falls into a "model not
// found" loop.
const ollamaAdapter = new OllamaApiAdapter({ 'baseUrl': 'http://127.0.0.1:11434' });
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
  // Browser: no native embedder is wired today (the browser built-in
  // LanguageModel doesn't expose embeddings, WebLLM embedding models would balloon the
  // download budget). LLM-only intent classification is the path here;
  // log once so the omission is visible in the demo log panel.
  logger.info('embedder: unavailable in browser; intent classification via LLM only');
  llm = new BaseLlmClient(adapter, { 'language': userLanguage });
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
const services: ArchivistServices = {
  'webSearch':        new OpenLibrarySearchTool(),
  'googleBooks':      new GoogleBooksTool(),
  'subjectSearch':    new SubjectSearchTool(),
  'wikipediaSummary': new WikipediaSummaryTool(),
  'memory':           new MemoryStore(),
  'llm':              llm,
  // Browser entry has no native embedder wired today. Browser built-in LanguageModel does
  // not expose embeddings and WebLLM embedding models would balloon the
  // download budget. Cosine recall and hybrid ranking fall back to
  // Jaccard / heuristics when embedder is null.
  'embedder':         null,
  'nodeTimeouts':     {},
};

// ObservedArchivist: a Dagonizer subclass that wires every lifecycle hook to
// its own internally-owned logger via protected hook overrides (the sole
// observability surface). The DOM driver keeps its own `DomConsoleLogger`
// (above) to stream its stage / result display lines into the `<pre>` panel.
const dispatcher = new ObservedArchivist();
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
dispatcher.registerBundle(BookSearchScatterBundleFactory.create(nodes));
dispatcher.registerBundle(ComposeRetryLoopBundleFactory.create(nodes));
dispatcher.registerBundle(ArchivistBundleFactory.create(nodes));
// #endregion register-bundle

// #region run-loop
// ── Submit handler: fresh state per ask. ──────────────────────────────────
form.addEventListener('submit', (event) => {
  event.preventDefault();
  const query = input.value.trim();
  if (query.length === 0) return;
  void ArchivistCli.ask(query);
});

// Default page = "open it and it just runs" with the seed question.
const SEED_QUERY = "I'm looking for a book about a strange house and a library";
input.value = SEED_QUERY;
void ArchivistCli.ask(SEED_QUERY);
// #endregion run-loop
