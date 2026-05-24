/**
 * runArchivist — end-to-end demo runner (CLI).
 *
 * Wires the registered nodes onto a `Dagonizer<ArchivistState, ArchivistServices>`,
 * registers the canonical DAG (and its embedded-DAG components), and runs one
 * visitor question through.
 *
 * Molecular embedded-DAG registration order:
 *   1. registerBookSearchFanoutNodes(dispatcher) — registers all nodes used by
 *      the book-search-fanout embedded-DAG (extract, decide, scouts, rank, merge, ...)
 *   2. dispatcher.registerDAG(BookSearchFanoutDAG) — registers the embedded-DAG itself
 *   3. registerComposeRetryLoopNodes(dispatcher) — compose, validate, respond
 *   4. dispatcher.registerDAG(ComposeRetryLoopDAG) — registers the compose embedded-DAG
 *   5. dispatcher.registerDAG(archivistDAG) — registers the parent (references embedded-DAGs by name)
 *
 * LLM resolved via `LlmAdapterCascade` over a registry of providers that
 * have credentials / local services available. Order of preference:
 *
 *   Ollama (localhost)  →  Gemini API  →  Cerebras  →  Groq
 *                       →  Mistral     →  OpenRouter
 *
 * Recommended local setup: `ollama pull llama3.2:latest` then
 * `ollama serve` — the cascade probe will hit `/api/tags` and route
 * the run through the local daemon with no API keys required.
 *
 * If no adapter is reachable the cascade throws
 * `LlmError(NO_ADAPTER_AVAILABLE)` — that's the design. There is no
 * stub fallback in the CLI; the stub exists only for tests.
 *
 * Run:  npx tsx examples/the-archivist/runArchivist.ts
 */

import { ArchivistState } from './ArchivistState.ts';
import { archivistDAG } from './dag.ts';
import {
  BookSearchFanoutDAG,
  registerBookSearchFanoutNodes,
} from './embedded-dags/BookSearchFanoutDAG.ts';
import {
  ComposeRetryLoopDAG,
  registerComposeRetryLoopNodes,
} from './embedded-dags/ComposeRetryLoopDAG.ts';
import { ConsoleLogger } from './logger/ConsoleLogger.ts';
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
import { CerebrasApiAdapter }   from '@noocodex/dagonizer-adapter-cerebras';
import { GeminiApiAdapter }     from '@noocodex/dagonizer-adapter-gemini-api';
import { GroqApiAdapter }       from '@noocodex/dagonizer-adapter-groq';
import { MistralApiAdapter }    from '@noocodex/dagonizer-adapter-mistral';
import { OllamaApiAdapter }     from '@noocodex/dagonizer-adapter-ollama';
import { OpenRouterApiAdapter } from '@noocodex/dagonizer-adapter-openrouter';
import { GeminiApiEmbedder }    from '@noocodex/dagonizer-embedder-gemini-api';
import { MistralEmbedder }      from '@noocodex/dagonizer-embedder-mistral';
import { OllamaEmbedder }       from '@noocodex/dagonizer-embedder-ollama';
import { BaseLlmClient } from './providers/BaseLlmClient.ts';
import { IntentClassifier } from './providers/IntentClassifier.ts';
import type { ArchivistServices, LlmClient } from './services.ts';
import { GoogleBooksTool } from '@noocodex/dagonizer-tool-googlebooks';
import { OpenLibrarySearchTool } from '@noocodex/dagonizer-tool-openlibrary';
import { SubjectSearchTool } from '@noocodex/dagonizer-tool-openlibrary';
import { WikipediaSummaryTool } from '@noocodex/dagonizer-tool-wikipedia';

import {
  Dagonizer,
  EmbedderCascade,
  EmbedderRegistry,
  LlmAdapterCascade,
  LlmAdapterRegistry,
  LlmError,
} from '@noocodex/dagonizer';
import type { AdapterCapabilities } from '@noocodex/dagonizer/adapter';
import { Checkpoint, MemoryCheckpointStore } from '@noocodex/dagonizer/checkpoint';

const logger = new ConsoleLogger();

// ── Backend: cascade over the registered adapters. The first probe that
//    resolves true wins; if none resolves, `cascade.select()` throws
//    `LlmError(NO_ADAPTER_AVAILABLE)` and the script fails loud.
function envVar(key: string): string {
  if (typeof process === 'undefined') return '';
  const raw = process.env[key];
  return typeof raw === 'string' ? raw : '';
}

const OLLAMA_BASE_URL = envVar('OLLAMA_BASE_URL') || 'http://127.0.0.1:11434';
const OLLAMA_MODEL    = envVar('OLLAMA_MODEL')    || 'llama3.2:latest';

// Capability shapes mirror each adapter's own declaration so the
// registry descriptor stays faithful to runtime behaviour. The
// registry doesn't enforce the value, but consumers reading
// `registry.list()` see the real shape.
const CAPS_FULL_TOOLS:    AdapterCapabilities = { 'toolUse': 'full',    'structuredOutput': true, 'jsonMode': true };
const CAPS_PARTIAL_TOOLS: AdapterCapabilities = { 'toolUse': 'partial', 'structuredOutput': true, 'jsonMode': true };

const registry = new LlmAdapterRegistry();

// Local-first — Ollama runs on the loopback by default and needs no
// credentials. Probe hits `/api/tags`; if it answers 2xx we're in.
registry.register(
  { 'provider': 'ollama', 'model': OLLAMA_MODEL, 'capabilities': CAPS_PARTIAL_TOOLS },
  () => new OllamaApiAdapter({ 'baseUrl': OLLAMA_BASE_URL, 'model': OLLAMA_MODEL }),
);

// Keyed providers — skip registration when the key is missing so the
// `NO_ADAPTER_AVAILABLE` message lists only the providers the user
// actually configured.
if (envVar('GEMINI_API_KEY').length > 0) {
  registry.register(
    { 'provider': 'gemini-api', 'model': 'gemini-2.0-flash', 'capabilities': CAPS_FULL_TOOLS },
    () => new GeminiApiAdapter(envVar('GEMINI_API_KEY'), { 'model': 'gemini-2.0-flash' }),
  );
}
if (envVar('CEREBRAS_API_KEY').length > 0) {
  registry.register(
    { 'provider': 'cerebras', 'model': 'gpt-oss-120b', 'capabilities': CAPS_PARTIAL_TOOLS },
    () => new CerebrasApiAdapter(envVar('CEREBRAS_API_KEY'), { 'model': 'gpt-oss-120b' }),
  );
}
if (envVar('GROQ_API_KEY').length > 0) {
  registry.register(
    { 'provider': 'groq', 'model': 'llama-3.3-70b-versatile', 'capabilities': CAPS_PARTIAL_TOOLS },
    () => new GroqApiAdapter(envVar('GROQ_API_KEY'), { 'model': 'llama-3.3-70b-versatile' }),
  );
}
if (envVar('MISTRAL_API_KEY').length > 0) {
  registry.register(
    { 'provider': 'mistral', 'model': 'mistral-small-latest', 'capabilities': CAPS_PARTIAL_TOOLS },
    () => new MistralApiAdapter(envVar('MISTRAL_API_KEY'), { 'model': 'mistral-small-latest' }),
  );
}
if (envVar('OPENROUTER_API_KEY').length > 0) {
  registry.register(
    { 'provider': 'openrouter', 'model': 'meta-llama/llama-3.3-70b-instruct:free', 'capabilities': CAPS_PARTIAL_TOOLS },
    () => new OpenRouterApiAdapter(envVar('OPENROUTER_API_KEY'), { 'model': 'meta-llama/llama-3.3-70b-instruct:free' }),
  );
}

const cascade = new LlmAdapterCascade(registry, [
  { 'provider': 'ollama',     'model': OLLAMA_MODEL },
  { 'provider': 'gemini-api', 'model': 'gemini-2.0-flash' },
  { 'provider': 'cerebras',   'model': 'gpt-oss-120b' },
  { 'provider': 'groq',       'model': 'llama-3.3-70b-versatile' },
  { 'provider': 'mistral',    'model': 'mistral-small-latest' },
  { 'provider': 'openrouter', 'model': 'meta-llama/llama-3.3-70b-instruct:free' },
]);

const adapter = await cascade.select();
logger.info(`backend: ${adapter.id} (${adapter.displayName})`);

// ── Embedder cascade — vector intent classification when reachable.
//    Order of preference mirrors the LLM cascade for symmetric local-first
//    behaviour: Ollama (loopback, no key) → Gemini REST → Mistral. When
//    nothing probes true the cascade throws; we catch and continue with
//    LLM-only classification.
const OLLAMA_EMBED_MODEL = envVar('OLLAMA_EMBED_MODEL') || 'nomic-embed-text';

const embedderRegistry = new EmbedderRegistry();
embedderRegistry.register(
  { 'provider': 'ollama', 'model': OLLAMA_EMBED_MODEL, 'capabilities': CAPS_PARTIAL_TOOLS },
  () => new OllamaEmbedder(OLLAMA_EMBED_MODEL, { 'baseUrl': OLLAMA_BASE_URL }),
);
if (envVar('GEMINI_API_KEY').length > 0) {
  embedderRegistry.register(
    { 'provider': 'gemini-api', 'model': 'text-embedding-004', 'capabilities': CAPS_FULL_TOOLS },
    () => new GeminiApiEmbedder(envVar('GEMINI_API_KEY')),
  );
}
if (envVar('MISTRAL_API_KEY').length > 0) {
  embedderRegistry.register(
    { 'provider': 'mistral', 'model': 'mistral-embed', 'capabilities': CAPS_PARTIAL_TOOLS },
    () => new MistralEmbedder(envVar('MISTRAL_API_KEY')),
  );
}

const embedderCascade = new EmbedderCascade(embedderRegistry, [
  { 'provider': 'ollama',     'model': OLLAMA_EMBED_MODEL },
  { 'provider': 'gemini-api', 'model': 'text-embedding-004' },
  { 'provider': 'mistral',    'model': 'mistral-embed' },
]);

let intentClassifier: IntentClassifier | undefined;
try {
  const embedder = await embedderCascade.select();
  intentClassifier = await IntentClassifier.create(embedder);
  logger.info(`embedder: ${embedder.id} (${embedder.displayName})`);
} catch (err) {
  if (err instanceof LlmError && err.classification.reason === 'NO_ADAPTER_AVAILABLE') {
    logger.info('embedder: none reachable — intent classification via LLM only');
  } else {
    throw err;
  }
}

const llm: LlmClient = new BaseLlmClient(adapter, intentClassifier !== undefined ? { intentClassifier } : {});

const services: ArchivistServices = {
  "webSearch":         OpenLibrarySearchTool,
  "googleBooks":       GoogleBooksTool,
  "subjectSearch":     SubjectSearchTool,
  "wikipediaSummary":  WikipediaSummaryTool,
  "memory":            new MemoryStore(),
  "llm":               llm,
  "logger":            logger,
};

// #region linear-run
// ── Dispatcher ───────────────────────────────────────────────────────────
const dispatcher = new Dagonizer<ArchivistState, ArchivistServices>({ services });

// ── Embedded-DAG node registration (molecular pattern) ───────────────────────
// Each embedded-DAG module exports a registerXxxNodes helper that registers
// the nodes it needs. Call it before registerDAG so the validator can
// resolve all node references when the DAG is registered.
registerBookSearchFanoutNodes(dispatcher);
dispatcher.registerDAG(BookSearchFanoutDAG);

registerComposeRetryLoopNodes(dispatcher);
dispatcher.registerDAG(ComposeRetryLoopDAG);

// ── Parent-DAG-only nodes (not used by embedded-DAGs) ────────────────────────
for (const node of [
  recallContext,
  classifyIntent,
  // Inlined branch nodes (reviews + describe) — not in the embedded-DAGs
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
  // recall-memories branch
  recallMemories,
  composeMemoryResponse,
  respondToVisitor,
  declineOffTopic,
  declineEmpty,
  // empty-result LLM response branch
  composeEmptyResponse,
]) {
  dispatcher.registerNode(node);
}

dispatcher.registerDAG(archivistDAG);

// ── Demo run ─────────────────────────────────────────────────────────────
const visitor = new ArchivistState();
visitor.query = "I'm looking for a book about a strange house and a library";

const result = await dispatcher.execute('the-archivist', visitor);

logger.result(`intent=${result.state.intent}`);
logger.result(`shortlist=${String(result.state.shortlist.length)}`);
logger.result(`draft=${result.state.draft}`);
logger.result(`lifecycle=${result.state.lifecycle.kind}`);
logger.result(`triples=${String(services.memory.size)} written`);
// #endregion linear-run

// #region cancellation-run
// Caller-driven cancellation — the visitor closes the page.
const controller = new AbortController();
// Simulate visitor abandoning 800 ms in.
setTimeout(() => controller.abort('visitor closed page'), 800);

const cancelVisitor = new ArchivistState();
cancelVisitor.query = "What's a book about a labyrinth?";

const cancelResult = await dispatcher.execute('the-archivist', cancelVisitor, {
  'signal':     controller.signal,
  'deadlineMs': 5000,              // hard 5s ceiling regardless of signal
});

const lc = cancelResult.state.lifecycle;
switch (lc.kind) {
  case 'completed':
    logger.result(`responded: ${cancelResult.state.draft}`);
    break;
  case 'cancelled':
    logger.result(`visitor abandoned at: ${lc.reason}`);
    break;
  case 'timed_out':
    logger.result(`hit deadline at: ${lc.finishedAt}`);
    break;
}

// result.cursor is the next node that would have run — pass it to
// Checkpoint.capture to persist and resume in a later process.
if (cancelResult.cursor !== null) {
  logger.result(`stopped at ${cancelResult.cursor} — resumable`);
}
// #endregion cancellation-run

// #region resume-run
if (cancelResult.cursor !== null) {
  const store = new MemoryCheckpointStore();
  const ckpt = await Checkpoint.capture('the-archivist', cancelResult);
  await ckpt.persist(store, `archivist:${cancelVisitor.query}`);

  const recalled = await Checkpoint.recall(store, `archivist:${cancelVisitor.query}`);
  if (recalled !== null) {
    const { dagName, state, cursor } = recalled.restoreState(
      (snap) => ArchivistState.restore(snap),
    );
    const resumeResult = await dispatcher.resume(dagName, state, cursor);
    logger.result(`resumed draft=${resumeResult.state.draft}`);
    logger.result(`resumed lifecycle=${resumeResult.state.lifecycle.kind}`);
  }
} else {
  logger.result('cancellation-run completed before cursor — no checkpoint needed');
}
// #endregion resume-run
