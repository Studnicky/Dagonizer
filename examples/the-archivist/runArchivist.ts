/**
 * runArchivist: end-to-end demo runner (CLI).
 *
 * Wires the registered nodes onto a `Dagonizer<ArchivistState, ArchivistServices>`,
 * registers the canonical DAG (and its embedded-DAG components), and runs one
 * visitor question through.
 *
 * Bundle registration order: each `DispatcherBundle` packages its own nodes
 * and DAG; `registerBundle` installs every node before every DAG so the
 * validator can resolve node references. Embedded-DAG bundles register before
 * the parent, which references them by name:
 *   1. dispatcher.registerBundle(bookSearchScatterBundle): scouts, extract,
 *      decide, rank, merge, record, gate, recall + the book-search-scatter DAG
 *   2. dispatcher.registerBundle(composeRetryLoopBundle): compose, validate
 *      + the compose-retry-loop DAG
 *   3. dispatcher.registerBundle(archivistBundle): parent-level nodes + the
 *      `the-archivist` DAG (references the embedded-DAGs by name)
 *
 * LLM resolved via `LlmAdapterCascade` over a registry of providers that
 * have credentials / local services available. Order of preference:
 *
 *   Ollama (localhost)  →  Gemini API  →  Cerebras  →  Groq
 *                       →  Mistral     →  OpenRouter
 *
 * Recommended local setup: pull any chat model (e.g. `ollama pull llama3.2:3b`)
 * then `ollama serve`. The runner reads `/api/tags` and picks an installed
 * chat model automatically (override with `OLLAMA_MODEL`); the cascade probe
 * routes the run through the local daemon with no API keys required.
 *
 * If no adapter is reachable the cascade throws
 * `LlmError(NO_ADAPTER_AVAILABLE)`: that's the design. There is no
 * fallback in the CLI.
 *
 * Run:  npx tsx examples/the-archivist/runArchivist.ts
 */

import { ArchivistState } from './ArchivistState.ts';
import { archivistBundle } from './dag.ts';
import { bookSearchScatterBundle } from './embedded-dags/BookSearchScatterDAG.ts';
import { composeRetryLoopBundle } from './embedded-dags/ComposeRetryLoopDAG.ts';
import { ConsoleLogger } from './logger/ConsoleLogger.ts';
import { MemoryStore } from './memory/MemoryStore.ts';
import { ObservedArchivist } from './ObservedArchivist.ts';
import { CerebrasApiAdapter }   from '@studnicky/dagonizer-adapter-cerebras';
import { GeminiApiAdapter }     from '@studnicky/dagonizer-adapter-gemini-api';
import { GroqApiAdapter }       from '@studnicky/dagonizer-adapter-groq';
import { MistralApiAdapter }    from '@studnicky/dagonizer-adapter-mistral';
import { OllamaApiAdapter }     from '@studnicky/dagonizer-adapter-ollama';
import { OpenRouterApiAdapter } from '@studnicky/dagonizer-adapter-openrouter';
import { GeminiApiEmbedder }    from '@studnicky/dagonizer-embedder-gemini-api';
import { MistralEmbedder }      from '@studnicky/dagonizer-embedder-mistral';
import { OllamaEmbedder }       from '@studnicky/dagonizer-embedder-ollama';
import { BaseLlmClient } from './providers/BaseLlmClient.ts';
import { IntentClassifier } from './providers/IntentClassifier.ts';
import { OllamaModels } from './providers/index.ts';
import { OllamaProbe } from './providers/adapters/index.ts';
import type { ArchivistServices, LlmClient } from './services.ts';
import { GoogleBooksTool } from '@studnicky/dagonizer-tool-googlebooks';
import { OpenLibrarySearchTool } from '@studnicky/dagonizer-tool-openlibrary';
import { SubjectSearchTool } from '@studnicky/dagonizer-tool-openlibrary';
import { WikipediaSummaryTool } from '@studnicky/dagonizer-tool-wikipedia';

import {
  EmbedderCascade,
  EmbedderRegistry,
  LlmAdapterCascade,
  LlmAdapterRegistry,
  LlmError,
} from '@studnicky/dagonizer/adapter';
import { ExecutionError, NodeTimeoutError } from '@studnicky/dagonizer/errors';
import type { AdapterCapabilities } from '@studnicky/dagonizer/adapter';
import type { Embedder } from '@studnicky/dagonizer/contracts';
import { Checkpoint, CheckpointRestoreAdapterFn, MemoryCheckpointStore } from '@studnicky/dagonizer/checkpoint';

const logger = new ConsoleLogger();

/**
 * Env: environment variable access utilities.
 */
class Env {
  static get(key: string): string {
    if (typeof process === 'undefined') return '';
    const raw = process.env[key];
    return typeof raw === 'string' ? raw : '';
  }
}

const OLLAMA_BASE_URL = Env.get('OLLAMA_BASE_URL') || 'http://127.0.0.1:11434';
// Model resolution: an explicit OLLAMA_MODEL env var wins; otherwise pick the
// first chat model the daemon actually has installed (GET /api/tags); only if
// both are unavailable fall back to a documented default so the registry still
// has a descriptor (the cascade probe fails closed when nothing is pulled).
const OLLAMA_MODEL    = Env.get('OLLAMA_MODEL')
  || OllamaModels.pickChat(await OllamaProbe.listModels())
  || 'llama3.2:latest';

// Capability shapes mirror each adapter's own declaration so the
// registry descriptor stays faithful to runtime behaviour. The
// registry doesn't enforce the value, but consumers reading
// `registry.list()` see the real shape.
const CAPS_FULL_TOOLS:    AdapterCapabilities = { 'toolUse': 'full',    'structuredOutput': true, 'jsonMode': true };
const CAPS_PARTIAL_TOOLS: AdapterCapabilities = { 'toolUse': 'partial', 'structuredOutput': true, 'jsonMode': true };

// #region adapter-cascade
const registry = new LlmAdapterRegistry();

// Local-first: Ollama runs on the loopback by default and needs no
// credentials. Probe hits `/api/tags`; if it answers 2xx we're in.
registry.register(
  { 'provider': 'ollama', 'model': OLLAMA_MODEL, 'capabilities': CAPS_PARTIAL_TOOLS },
  () => new OllamaApiAdapter({ 'baseUrl': OLLAMA_BASE_URL, 'model': OLLAMA_MODEL }),
);

// Keyed providers: skip registration when the key is missing so the
// `NO_ADAPTER_AVAILABLE` message lists only the providers the user
// actually configured.
if (Env.get('GEMINI_API_KEY').length > 0) {
  registry.register(
    { 'provider': 'gemini-api', 'model': 'gemini-2.0-flash', 'capabilities': CAPS_FULL_TOOLS },
    () => new GeminiApiAdapter(Env.get('GEMINI_API_KEY'), { 'model': 'gemini-2.0-flash' }),
  );
}
if (Env.get('CEREBRAS_API_KEY').length > 0) {
  registry.register(
    { 'provider': 'cerebras', 'model': 'gpt-oss-120b', 'capabilities': CAPS_PARTIAL_TOOLS },
    () => new CerebrasApiAdapter(Env.get('CEREBRAS_API_KEY'), { 'model': 'gpt-oss-120b' }),
  );
}
if (Env.get('GROQ_API_KEY').length > 0) {
  registry.register(
    { 'provider': 'groq', 'model': 'llama-3.3-70b-versatile', 'capabilities': CAPS_PARTIAL_TOOLS },
    () => new GroqApiAdapter(Env.get('GROQ_API_KEY'), { 'model': 'llama-3.3-70b-versatile' }),
  );
}
if (Env.get('MISTRAL_API_KEY').length > 0) {
  registry.register(
    { 'provider': 'mistral', 'model': 'mistral-small-latest', 'capabilities': CAPS_PARTIAL_TOOLS },
    () => new MistralApiAdapter(Env.get('MISTRAL_API_KEY'), { 'model': 'mistral-small-latest' }),
  );
}
if (Env.get('OPENROUTER_API_KEY').length > 0) {
  registry.register(
    { 'provider': 'openrouter', 'model': 'meta-llama/llama-3.3-70b-instruct:free', 'capabilities': CAPS_PARTIAL_TOOLS },
    () => new OpenRouterApiAdapter(Env.get('OPENROUTER_API_KEY'), { 'model': 'meta-llama/llama-3.3-70b-instruct:free' }),
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
// #endregion adapter-cascade

// #region embedder-cascade
// ── Embedder cascade: vector intent classification when reachable.
//    Order of preference mirrors the LLM cascade for symmetric local-first
//    behaviour: Ollama (loopback, no key) → Gemini REST → Mistral. When
//    nothing probes true the cascade throws; we catch and continue with
//    LLM-only classification.
const OLLAMA_EMBED_MODEL = Env.get('OLLAMA_EMBED_MODEL') || 'nomic-embed-text';

const embedderRegistry = new EmbedderRegistry();
embedderRegistry.register(
  { 'provider': 'ollama', 'model': OLLAMA_EMBED_MODEL, 'capabilities': CAPS_PARTIAL_TOOLS },
  () => new OllamaEmbedder({ 'model': OLLAMA_EMBED_MODEL, 'baseUrl': OLLAMA_BASE_URL }),
);
if (Env.get('GEMINI_API_KEY').length > 0) {
  embedderRegistry.register(
    { 'provider': 'gemini-api', 'model': 'text-embedding-004', 'capabilities': CAPS_FULL_TOOLS },
    () => new GeminiApiEmbedder(Env.get('GEMINI_API_KEY')),
  );
}
if (Env.get('MISTRAL_API_KEY').length > 0) {
  embedderRegistry.register(
    { 'provider': 'mistral', 'model': 'mistral-embed', 'capabilities': CAPS_PARTIAL_TOOLS },
    () => new MistralEmbedder(Env.get('MISTRAL_API_KEY')),
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
    logger.info('embedder: none reachable; intent classification via LLM only, recall falls back to Jaccard');
  } else {
    throw err;
  }
}
// #endregion embedder-cascade

const llm: LlmClient = new BaseLlmClient(adapter, intentClassifier !== undefined ? { intentClassifier } : {});

const services: ArchivistServices = {
  "webSearch":         new OpenLibrarySearchTool(),
  "googleBooks":       new GoogleBooksTool(),
  "subjectSearch":     new SubjectSearchTool(),
  "wikipediaSummary":  new WikipediaSummaryTool(),
  "memory":            new MemoryStore(),
  "llm":               llm,
  "embedder":          resolvedEmbedder,
  "nodeTimeouts":      {},
  "logger":            logger,
};

// #region linear-run
// ── Dispatcher ───────────────────────────────────────────────────────────
// ObservedArchivist: Dagonizer subclass wiring every lifecycle hook to the
// logger via protected hook overrides (the sole observability surface).
const dispatcher = new ObservedArchivist(
  { services },
  logger,
);

// ── Bundle registration (molecular pattern) ──────────────────────────────
// Each bundle packages its nodes + DAG. Embedded-DAG bundles register first
// so the parent's semantic validator can resolve embedded references by name.
dispatcher.registerBundle(bookSearchScatterBundle);
dispatcher.registerBundle(composeRetryLoopBundle);
dispatcher.registerBundle(archivistBundle);

// ── Demo run ─────────────────────────────────────────────────────────────
const visitor = new ArchivistState();
visitor.query = "I'm looking for a book about a strange house and a library";

// #region error-taxonomy
// ExecutionError wraps a node throw that was not a timeout.
// NodeTimeoutError fires when the dispatcher's per-node deadline elapses.
// LlmError wraps adapter-level failures (rate limit, bad credentials, etc.).
// Distinguish by class so callers can log or retry at the right granularity.
let result;
try {
  const execution = dispatcher.execute('the-archivist', visitor);
  for await (const stage of execution) {
    logger.info(`▸ ${stage.nodeName}${stage.skipped ? ' (skipped)' : ` → ${stage.output ?? '(none)'}`}`);
  }
  result = await execution;
} catch (err) {
  if (err instanceof NodeTimeoutError) {
    logger.warn(`node timed out: ${err.message}`);
    throw err;
  }
  if (err instanceof ExecutionError) {
    logger.warn(`execution failed: ${err.message}`);
    throw err;
  }
  // #region llm-error-catch
  if (err instanceof LlmError) {
    logger.warn(`llm error [${err.classification.reason}]: ${err.message}`);
    throw err;
  }
  // #endregion llm-error-catch
  throw err;
}
// #endregion error-taxonomy

logger.result(`intent=${result.state.intent}`);
logger.result(`shortlist=${String(result.state.shortlist.length)}`);
logger.result(`draft=${result.state.draft}`);
logger.result(`lifecycle=${result.state.lifecycle.kind}`);
logger.result(`triples=${String(services.memory.size)} written`);
// #endregion linear-run

// #region cancellation-run
// Caller-driven cancellation: the visitor closes the page.
const controller = new AbortController();
// Simulate visitor abandoning 800 ms in.
setTimeout(() => controller.abort('visitor closed page'), 800);

const cancelVisitor = new ArchivistState();
cancelVisitor.query = "What's a book about a labyrinth?";

const cancelResult = await dispatcher.execute('the-archivist', cancelVisitor, {
  'signal':     controller.signal,
  'deadlineMs': 5000,              // hard 5s ceiling regardless of signal
});

// #region lifecycle-state-switch
// lifecycle.kind is a discriminated union: 'completed' | 'cancelled' | 'timed_out'.
// Each arm carries only the fields relevant to that outcome (e.g. reason, finishedAt).
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
// #endregion lifecycle-state-switch

// result.cursor is the next node that would have run; pass it to
// Checkpoint.capture to persist and resume in a later process.
if (cancelResult.cursor !== null) {
  logger.result(`stopped at ${cancelResult.cursor} (resumable)`);
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
      CheckpointRestoreAdapterFn.fromFn((snap) => ArchivistState.restore(snap)),
    );
    const resumeResult = await dispatcher.resume(dagName, state, cursor);
    logger.result(`resumed draft=${resumeResult.state.draft}`);
    logger.result(`resumed lifecycle=${resumeResult.state.lifecycle.kind}`);
    logger.result(`resumed memory triples=${String(freshMemory.size)}`);
  }
} else {
  logger.result('cancellation-run completed before cursor; no checkpoint needed');
}
// #endregion resume-run
