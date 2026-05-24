/**
 * main.ts — browser entrypoint for the Archivist demo.
 *
 * Mirrors `runArchivist.ts`'s setup but composes a browser-runnable
 * cascade and streams the logger to the DOM. Default preference:
 *
 *   Gemini Nano (Chrome on-device, flag-gated)
 *     →  WebLLM      (any WebGPU browser; ~700 MB model download on first use)
 *     →  Gemini API  (REST; key supplied via `?apiKey=…` URL param)
 *     →  Ollama      (only when running locally with CORS enabled — see below)
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
import { archivistDAG } from './dag.ts';
import { UserLanguage } from './language/UserLanguage.ts';
import {
  BookSearchFanoutDAG,
  registerBookSearchFanoutNodes,
} from './deepdags/BookSearchFanoutDAG.ts';
import {
  ComposeRetryLoopDAG,
  registerComposeRetryLoopNodes,
} from './deepdags/ComposeRetryLoopDAG.ts';
import { ConsoleLogger, type LogEvent } from './logger/ConsoleLogger.ts';
import { MemoryStore } from './memory/MemoryStore.ts';
import { classifyIntent } from './nodes/classifyIntent.ts';
import { composeMemoryResponse } from './nodes/composeMemoryResponse.ts';
import { decideTools } from './nodes/decideTools.ts';
import { extractQuery } from './nodes/extractQuery.ts';
import { groupByYear } from './nodes/groupByYear.ts';
import { hasCitationsGate } from './nodes/hasCitationsGate.ts';
import { mergeCandidates } from './nodes/mergeCandidates.ts';
import { pickBestMatch } from './nodes/pickBestMatch.ts';
import { rankByRating } from './nodes/rankByRating.ts';
import { recallContext } from './nodes/recallContext.ts';
import { recallMemories } from './nodes/recallMemories.ts';
import { recallPastVisits } from './nodes/recallPastVisits.ts';
import { recommendSimilar } from './nodes/recommendSimilar.ts';
import { recordFindings } from './nodes/recordFindings.ts';
import { composeEmptyResponse, declineEmpty, declineOffTopic, respondToVisitor } from './nodes/respondToVisitor.ts';
import { openLibraryScout, googleBooksScout, subjectScout, wikipediaScout, webSearchScout } from './nodes/scouts.ts';
import { BaseLlmClient } from './providers/BaseLlmClient.ts';
import type { ArchivistServices, LlmClient } from './services.ts';

import { GeminiApiAdapter }   from '@noocodex/dagonizer-adapter-gemini-api';
import { GeminiNanoAdapter }  from '@noocodex/dagonizer-adapter-gemini-nano';
import { OllamaApiAdapter }   from '@noocodex/dagonizer-adapter-ollama';
import { WebLlmAdapter }      from '@noocodex/dagonizer-adapter-web-llm';

import { Dagonizer, LlmAdapterCascade, LlmAdapterRegistry } from '@noocodex/dagonizer';
import type { AdapterCapabilities } from '@noocodex/dagonizer/adapter';

import { GoogleBooksTool }       from '@noocodex/dagonizer-tool-googlebooks';
import { OpenLibrarySearchTool, SubjectSearchTool } from '@noocodex/dagonizer-tool-openlibrary';
import { WikipediaSummaryTool }  from '@noocodex/dagonizer-tool-wikipedia';

// ── DOM ──────────────────────────────────────────────────────────────────
const form    = document.getElementById('ask-form')      as HTMLFormElement;
const input   = document.getElementById('ask-input')     as HTMLInputElement;
const button  = document.getElementById('ask-button')    as HTMLButtonElement;
const logEl   = document.getElementById('archivist-log') as HTMLPreElement;

// ── Logger wiring — stream every event to the <pre>. ─────────────────────
const logger = new ConsoleLogger();
function appendLogLine(event: LogEvent): void {
  const line = document.createElement('span');
  line.className = event.level;
  line.textContent = `[${event.level}] ${event.message}\n`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}
function appendErrorLine(message: string): void {
  const line = document.createElement('span');
  line.className = 'error';
  line.textContent = `[error] ${message}\n`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}
logger.subscribe(appendLogLine);

// ── Cascade — browser-runnable adapters in preference order. ─────────────
const CAPS_FULL_TOOLS:    AdapterCapabilities = { 'toolUse': 'full',    'structuredOutput': true, 'jsonMode': true };
const CAPS_PARTIAL_TOOLS: AdapterCapabilities = { 'toolUse': 'partial', 'structuredOutput': true, 'jsonMode': true };
const CAPS_NO_TOOLS:      AdapterCapabilities = { 'toolUse': 'none',    'structuredOutput': true, 'jsonMode': false };

const params = new URLSearchParams(window.location.search);
const urlApiKey = params.get('apiKey') ?? '';

// Visitor device language: URL `?lang=` overrides browser detection.
const urlLang = params.get('lang') ?? '';
const userLanguage = urlLang.length > 0
  ? UserLanguage.normalize(urlLang)
  : UserLanguage.detect();
logger.info(`language: ${userLanguage} (${UserLanguage.displayName(userLanguage)})`);

const registry = new LlmAdapterRegistry();

// On-device first.
registry.register(
  { 'provider': 'gemini-nano', 'model': 'on-device', 'capabilities': CAPS_NO_TOOLS },
  () => new GeminiNanoAdapter(),
);

// WebGPU-accelerated in-browser model. Lazy-downloads on first chat.
registry.register(
  { 'provider': 'web-llm', 'model': 'Phi-3.5-mini-instruct-q4f16_1-MLC', 'capabilities': CAPS_PARTIAL_TOOLS },
  () => new WebLlmAdapter({ 'onProgress': (report) => logger.info(`web-llm: ${report.text} (${String(Math.round(report.progress * 100))}%)`) }),
);

// REST fallback — key from URL param, otherwise prompt the visitor.
registry.register(
  { 'provider': 'gemini-api', 'model': 'gemini-2.0-flash', 'capabilities': CAPS_FULL_TOOLS },
  () => {
    const key = urlApiKey.length > 0 ? urlApiKey : (window.prompt('Gemini API key (AI Studio):') ?? '');
    return new GeminiApiAdapter(key, { 'model': 'gemini-2.0-flash' });
  },
);

// Ollama — only useful when the daemon is running locally with CORS
// allowed (see the file-level comment). Probe fails closed otherwise.
registry.register(
  { 'provider': 'ollama', 'model': 'llama3.2:latest', 'capabilities': CAPS_PARTIAL_TOOLS },
  () => new OllamaApiAdapter({ 'baseUrl': 'http://127.0.0.1:11434', 'model': 'llama3.2:latest' }),
);

const cascade = new LlmAdapterCascade(registry, [
  { 'provider': 'gemini-nano', 'model': 'on-device' },
  { 'provider': 'web-llm',     'model': 'Phi-3.5-mini-instruct-q4f16_1-MLC' },
  { 'provider': 'gemini-api',  'model': 'gemini-2.0-flash' },
  { 'provider': 'ollama',      'model': 'llama3.2:latest' },
]);

let llm: LlmClient;
try {
  const adapter = await cascade.select();
  // Browser: no native embedder is wired today (Gemini Nano doesn't
  // expose embeddings, WebLLM embedding models would balloon the
  // download budget). LLM-only intent classification is the path here;
  // log once so the omission is visible in the demo log panel.
  logger.info('embedder: unavailable in browser — intent classification via LLM only');
  llm = new BaseLlmClient(adapter, { 'language': userLanguage });
  logger.info(`backend: ${adapter.id} (${adapter.displayName})`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  appendErrorLine(message);
  button.disabled = true;
  input.disabled = true;
  throw err;
}

// ── Dispatcher + DAG registration (mirrors runArchivist.ts). ─────────────
const services: ArchivistServices = {
  'webSearch':        OpenLibrarySearchTool,
  'googleBooks':      GoogleBooksTool,
  'subjectSearch':    SubjectSearchTool,
  'wikipediaSummary': WikipediaSummaryTool,
  'memory':           new MemoryStore(),
  'llm':              llm,
  'logger':           logger,
};

const dispatcher = new Dagonizer<ArchivistState, ArchivistServices>({ services });

registerBookSearchFanoutNodes(dispatcher);
dispatcher.registerDAG(BookSearchFanoutDAG);

registerComposeRetryLoopNodes(dispatcher);
dispatcher.registerDAG(ComposeRetryLoopDAG);

for (const node of [
  recallContext,
  classifyIntent,
  extractQuery,
  decideTools,
  webSearchScout,
  openLibraryScout,
  googleBooksScout,
  subjectScout,
  wikipediaScout,
  rankByRating,
  pickBestMatch,
  mergeCandidates,
  recordFindings,
  hasCitationsGate,
  groupByYear,
  recallPastVisits,
  recommendSimilar,
  recallMemories,
  composeMemoryResponse,
  respondToVisitor,
  declineOffTopic,
  declineEmpty,
  composeEmptyResponse,
]) {
  dispatcher.registerNode(node);
}

dispatcher.registerDAG(archivistDAG);

// ── Submit handler — fresh state per ask. ─────────────────────────────────
async function ask(query: string): Promise<void> {
  const visitor = new ArchivistState();
  visitor.query = query;
  button.disabled = true;
  try {
    const result = await dispatcher.execute('the-archivist', visitor);
    logger.result(`intent=${result.state.intent}`);
    logger.result(`shortlist=${String(result.state.shortlist.length)}`);
    logger.result(`draft=${result.state.draft}`);
    logger.result(`lifecycle=${result.state.lifecycle.kind}`);
  } catch (err) {
    appendErrorLine(err instanceof Error ? err.message : String(err));
  } finally {
    button.disabled = false;
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const query = input.value.trim();
  if (query.length === 0) return;
  void ask(query);
});

// Default page = "open it and it just runs" with the seed question.
const SEED_QUERY = "I'm looking for a book about a strange house and a library";
input.value = SEED_QUERY;
void ask(SEED_QUERY);
