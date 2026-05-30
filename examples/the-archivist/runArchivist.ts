/**
 * runArchivist — end-to-end demo runner (CLI).
 *
 * Wires the registered nodes onto a `Dagonizer<ArchivistState, ArchivistServices>`,
 * registers the canonical DAG (and its embedded-DAG components), and runs one
 * visitor question through.
 *
 * Bundle registration order — each `DispatcherBundle` packages its own nodes
 * and DAG; `registerBundle` installs every node before every DAG so the
 * validator can resolve node references. Embedded-DAG bundles register before
 * the parent, which references them by name:
 *   1. dispatcher.registerBundle(bookSearchScatterBundle) — scouts, extract,
 *      decide, rank, merge, record, gate, recall + the book-search-scatter DAG
 *   2. dispatcher.registerBundle(composeRetryLoopBundle) — compose, validate
 *      + the compose-retry-loop DAG
 *   3. dispatcher.registerBundle(archivistBundle) — parent-level nodes + the
 *      `the-archivist` DAG (references the embedded-DAGs by name)
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
import { archivistBundle } from './dag.ts';
import { bookSearchScatterBundle } from './embedded-dags/BookSearchScatterDAG.ts';
import { composeRetryLoopBundle } from './embedded-dags/ComposeRetryLoopDAG.ts';
import { ConsoleLogger } from './logger/ConsoleLogger.ts';
import { MemoryStore } from './memory/MemoryStore.ts';
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
import type { Embedder } from '@noocodex/dagonizer/contracts';
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
let resolvedEmbedder: Embedder | null = null;
try {
  resolvedEmbedder = await embedderCascade.select();
  intentClassifier = await IntentClassifier.create(resolvedEmbedder);
  logger.info(`embedder: ${resolvedEmbedder.id} (${resolvedEmbedder.displayName})`);
} catch (err) {
  if (err instanceof LlmError && err.classification.reason === 'NO_ADAPTER_AVAILABLE') {
    logger.info('embedder: none reachable — intent classification via LLM only, recall falls back to Jaccard');
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
  "embedder":          resolvedEmbedder,
  "nodeTimeouts":      {},
  "logger":            logger,
};

// #region linear-run
// ── Dispatcher ───────────────────────────────────────────────────────────
const dispatcher = new Dagonizer<ArchivistState, ArchivistServices>({ services });

// ── Bundle registration (molecular pattern) ──────────────────────────────
// Each bundle packages its nodes + DAG. Embedded-DAG bundles register first
// so the parent's semantic validator can resolve embedded references by name.
dispatcher.registerBundle(bookSearchScatterBundle);
dispatcher.registerBundle(composeRetryLoopBundle);
dispatcher.registerBundle(archivistBundle);

// ── Demo run ─────────────────────────────────────────────────────────────
const visitor = new ArchivistState();
visitor.query = "I'm looking for a book about a strange house and a library";

const execution = dispatcher.execute('the-archivist', visitor);
for await (const stage of execution) {
  logger.info(`▸ ${stage.nodeName}${stage.skipped ? ' (skipped)' : ` → ${stage.output ?? '—'}`}`);
}
const result = await execution;

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
  const ckpt = await Checkpoint.capture('the-archivist', cancelResult, { 'stores': { 'memory': services.memory } });
  await ckpt.persist(store, `archivist:${cancelVisitor.query}`);

  const recalled = await Checkpoint.recall(store, `archivist:${cancelVisitor.query}`);
  if (recalled !== null) {
    const freshMemory = new MemoryStore();
    await recalled.restoreStores({ 'memory': freshMemory });
    const { dagName, state, cursor } = recalled.restoreState(
      (snap) => ArchivistState.restore(snap),
    );
    const resumeResult = await dispatcher.resume(dagName, state, cursor);
    logger.result(`resumed draft=${resumeResult.state.draft}`);
    logger.result(`resumed lifecycle=${resumeResult.state.lifecycle.kind}`);
    logger.result(`resumed memory triples=${String(freshMemory.size)}`);
  }
} else {
  logger.result('cancellation-run completed before cursor — no checkpoint needed');
}
// #endregion resume-run
