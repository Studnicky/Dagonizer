/**
 * runArchivist: end-to-end demo runner (CLI).
 *
 * Wires the registered nodes onto a `Dagonizer<ArchivistState, ArchivistServices>`,
 * registers the canonical DAG (and its embedded-DAG components), and runs one
 * visitor question through.
 *
 * Bundle registration order: each `DispatcherBundleType` packages its own nodes
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
 * then `ollama serve`. The cascade constructs an `OllamaApiAdapter` and calls
 * `selectChatModel({ preferred: OLLAMA_MODEL })` to discover and set an
 * installed chat model automatically (override with `OLLAMA_MODEL` env var).
 * The cascade probe routes the run through the local daemon with no API keys
 * required.
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
import type { ArchivistServices, LlmClientInterface } from './services.ts';
import { GoogleBooksTool } from '@studnicky/dagonizer-tool-googlebooks';
import { OpenLibrarySearchTool } from '@studnicky/dagonizer-tool-openlibrary';
import { SubjectSearchTool } from '@studnicky/dagonizer-tool-openlibrary';
import { WikipediaSummaryTool } from '@studnicky/dagonizer-tool-wikipedia';
import { ToolRegistry } from '@studnicky/dagonizer/tool';

import {
  EmbedderCascade,
  EmbedderRegistry,
  LlmAdapterCascade,
  LlmAdapterRegistry,
  LlmError,
} from '@studnicky/dagonizer/adapter';
import { ExecutionError, NodeTimeoutError } from '@studnicky/dagonizer/errors';
import type { AdapterCapabilitiesType } from '@studnicky/dagonizer/adapter';
import type { EmbedderInterface } from '@studnicky/dagonizer/contracts';
import { Checkpoint, CheckpointRestoreAdapter, MemoryCheckpointStore } from '@studnicky/dagonizer/checkpoint';

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

// Capability shapes mirror each adapter's own declaration so the
// registry descriptor stays faithful to runtime behaviour. The
// registry doesn't enforce the value, but consumers reading
// `registry.list()` see the real shape.
const CAPS_FULL_TOOLS:    AdapterCapabilitiesType = { 'toolUse': 'full',    'structuredOutput': true, 'jsonMode': true };
const CAPS_PARTIAL_TOOLS: AdapterCapabilitiesType = { 'toolUse': 'partial', 'structuredOutput': true, 'jsonMode': true };

// #region adapter-cascade
// Local-first: construct the Ollama adapter, then discover and set the best
// available chat model via `selectChatModel`. The env override (`OLLAMA_MODEL`)
// is honored when present and the daemon has it pulled; otherwise the first
// installed non-embedding model is selected. Returns null when the daemon is
// down or has no chat model, causing the registry entry to be skipped.
const ollamaAdapter = new OllamaApiAdapter({ 'baseUrl': OLLAMA_BASE_URL });
const resolvedOllamaModel = await ollamaAdapter.selectChatModel({
  ...(Env.get('OLLAMA_MODEL').length > 0 ? { 'preferred': Env.get('OLLAMA_MODEL') } : {}),
});

const registry = new LlmAdapterRegistry();

// Register Ollama only when a usable chat model was discovered.
if (resolvedOllamaModel !== null) {
  registry.register(
    { 'provider': 'ollama', 'model': resolvedOllamaModel, 'capabilities': CAPS_PARTIAL_TOOLS },
    () => ollamaAdapter,
  );
}

// Keyed providers: skip registration when the key is missing so the
// `NO_ADAPTER_AVAILABLE` message lists only the providers the user
// actually configured. Each adapter discovers and sets its model via
// `selectChatModel` before the cascade probe; the env var override
// is honored when the provider lists it, otherwise the adapter's own
// default is used.
if (Env.get('GEMINI_API_KEY').length > 0) {
  const geminiAdapter = new GeminiApiAdapter(Env.get('GEMINI_API_KEY'));
  const geminiModel = await geminiAdapter.selectChatModel({
    ...(Env.get('GEMINI_MODEL').length > 0 ? { 'preferred': Env.get('GEMINI_MODEL') } : {}),
  });
  if (geminiModel !== null) {
    registry.register(
      { 'provider': 'gemini-api', 'model': geminiModel, 'capabilities': CAPS_FULL_TOOLS },
      () => geminiAdapter,
    );
  }
}
if (Env.get('CEREBRAS_API_KEY').length > 0) {
  const cerebrasAdapter = new CerebrasApiAdapter(Env.get('CEREBRAS_API_KEY'));
  const cerebrasModel = await cerebrasAdapter.selectChatModel({
    ...(Env.get('CEREBRAS_MODEL').length > 0 ? { 'preferred': Env.get('CEREBRAS_MODEL') } : {}),
  });
  if (cerebrasModel !== null) {
    registry.register(
      { 'provider': 'cerebras', 'model': cerebrasModel, 'capabilities': CAPS_PARTIAL_TOOLS },
      () => cerebrasAdapter,
    );
  }
}
if (Env.get('GROQ_API_KEY').length > 0) {
  const groqAdapter = new GroqApiAdapter(Env.get('GROQ_API_KEY'));
  const groqModel = await groqAdapter.selectChatModel({
    ...(Env.get('GROQ_MODEL').length > 0 ? { 'preferred': Env.get('GROQ_MODEL') } : {}),
  });
  if (groqModel !== null) {
    registry.register(
      { 'provider': 'groq', 'model': groqModel, 'capabilities': CAPS_PARTIAL_TOOLS },
      () => groqAdapter,
    );
  }
}
if (Env.get('MISTRAL_API_KEY').length > 0) {
  const mistralAdapter = new MistralApiAdapter(Env.get('MISTRAL_API_KEY'));
  const mistralModel = await mistralAdapter.selectChatModel({
    ...(Env.get('MISTRAL_MODEL').length > 0 ? { 'preferred': Env.get('MISTRAL_MODEL') } : {}),
  });
  if (mistralModel !== null) {
    registry.register(
      { 'provider': 'mistral', 'model': mistralModel, 'capabilities': CAPS_PARTIAL_TOOLS },
      () => mistralAdapter,
    );
  }
}
if (Env.get('OPENROUTER_API_KEY').length > 0) {
  const openRouterAdapter = new OpenRouterApiAdapter(Env.get('OPENROUTER_API_KEY'));
  const openRouterModel = await openRouterAdapter.selectChatModel({
    ...(Env.get('OPENROUTER_MODEL').length > 0 ? { 'preferred': Env.get('OPENROUTER_MODEL') } : {}),
  });
  if (openRouterModel !== null) {
    registry.register(
      { 'provider': 'openrouter', 'model': openRouterModel, 'capabilities': CAPS_PARTIAL_TOOLS },
      () => openRouterAdapter,
    );
  }
}

// Cascade preference order matches the registration order above.
// `registry.list()` returns only the registered (available) providers,
// so the cascade probe always has a valid model name on each entry.
const cascade = new LlmAdapterCascade(registry, registry.list().map((entry) => ({
  'provider': entry.provider,
  'model': entry.model,
})));

const adapter = await cascade.select();
logger.info(`backend: ${adapter.id} (${adapter.displayName})`);
// #endregion adapter-cascade

// #region embedder-cascade
// ── EmbedderInterface cascade: vector intent classification when reachable.
//    Order of preference mirrors the LLM cascade for symmetric local-first
//    behaviour: Ollama (loopback, no key) → Gemini REST → Mistral. When
//    nothing probes true the cascade throws; we catch and continue with
//    LLM-only classification. Each embedder discovers its model via
//    `selectEmbeddingModel({ preferred })` before registration; the env var
//    override is honored when the provider lists it, otherwise the embedder's
//    own default is used.

const embedderRegistry = new EmbedderRegistry();

const ollamaEmbedder = new OllamaEmbedder({ 'baseUrl': OLLAMA_BASE_URL });
const resolvedOllamaEmbedModel = await ollamaEmbedder.selectEmbeddingModel({
  ...(Env.get('OLLAMA_EMBED_MODEL').length > 0 ? { 'preferred': Env.get('OLLAMA_EMBED_MODEL') } : {}),
});
if (resolvedOllamaEmbedModel !== null) {
  embedderRegistry.register(
    { 'provider': 'ollama', 'model': resolvedOllamaEmbedModel, 'capabilities': CAPS_PARTIAL_TOOLS },
    () => ollamaEmbedder,
  );
}

if (Env.get('GEMINI_API_KEY').length > 0) {
  const geminiEmbedder = new GeminiApiEmbedder(Env.get('GEMINI_API_KEY'));
  const geminiEmbedModel = await geminiEmbedder.selectEmbeddingModel({
    ...(Env.get('GEMINI_EMBED_MODEL').length > 0 ? { 'preferred': Env.get('GEMINI_EMBED_MODEL') } : {}),
  });
  if (geminiEmbedModel !== null) {
    embedderRegistry.register(
      { 'provider': 'gemini-api', 'model': geminiEmbedModel, 'capabilities': CAPS_FULL_TOOLS },
      () => geminiEmbedder,
    );
  }
}
if (Env.get('MISTRAL_API_KEY').length > 0) {
  const mistralEmbedder = new MistralEmbedder(Env.get('MISTRAL_API_KEY'));
  const mistralEmbedModel = await mistralEmbedder.selectEmbeddingModel({
    ...(Env.get('MISTRAL_EMBED_MODEL').length > 0 ? { 'preferred': Env.get('MISTRAL_EMBED_MODEL') } : {}),
  });
  if (mistralEmbedModel !== null) {
    embedderRegistry.register(
      { 'provider': 'mistral', 'model': mistralEmbedModel, 'capabilities': CAPS_PARTIAL_TOOLS },
      () => mistralEmbedder,
    );
  }
}

const embedderCascade = new EmbedderCascade(embedderRegistry, embedderRegistry.list().map((entry) => ({
  'provider': entry.provider,
  'model': entry.model,
})));

let intentClassifier: IntentClassifier | undefined;
let resolvedEmbedder: EmbedderInterface | null = null;
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

const llm: LlmClientInterface = new BaseLlmClient(adapter, intentClassifier !== undefined ? { intentClassifier } : {});

const services: ArchivistServices = {
  "webSearch":         new OpenLibrarySearchTool(),
  "googleBooks":       new GoogleBooksTool(),
  "subjectSearch":     new SubjectSearchTool(),
  "wikipediaSummary":  new WikipediaSummaryTool(),
  "memory":            new MemoryStore(),
  "llm":               llm,
  "embedder":          resolvedEmbedder,
  "nodeTimeouts":      {},
};

// #region linear-run
// ── Dispatcher ───────────────────────────────────────────────────────────
// ObservedArchivist: Dagonizer subclass wiring every lifecycle hook to its
// own internally-owned logger via protected hook overrides (the sole
// observability surface). The driver reads `dispatcher.logger` for its own
// stage / result display so both streams share one console sink.
const dispatcher = new ObservedArchivist({ services });

// ── Tool registry (molecular pattern) ────────────────────────────────────
// Register each book-search tool as an embeddable `tool:<name>` DAG.
// ToolRegistry.bundle() returns the synthesized nodes + DAGs so the
// dispatcher resolves `tool:web_search_books`, `tool:google_books_search`,
// `tool:subject_search`, and `tool:wikipedia_summary` by name at scatter time.
// Register BEFORE bookSearchScatterBundle so the embedded-DAG references
// from the scatter body are resolvable when the parent DAG is validated.
const toolRegistry = new ToolRegistry();
toolRegistry.register(new OpenLibrarySearchTool());
toolRegistry.register(new GoogleBooksTool());
toolRegistry.register(new SubjectSearchTool());
toolRegistry.register(new WikipediaSummaryTool());
dispatcher.registerBundle(toolRegistry.bundle<ArchivistServices>());

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
logger.result(`lifecycle=${result.state.lifecycle.variant}`);
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
// lifecycle.variant is a discriminated union: 'completed' | 'cancelled' | 'timed_out'.
// Each arm carries only the fields relevant to that outcome (e.g. reason, finishedAt).
const lc = cancelResult.state.lifecycle;
switch (lc.variant) {
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
      CheckpointRestoreAdapter.wrap((snap) => ArchivistState.restore(snap)),
    );
    const resumeResult = await dispatcher.resume(dagName, state, cursor);
    logger.result(`resumed draft=${resumeResult.state.draft}`);
    logger.result(`resumed lifecycle=${resumeResult.state.lifecycle.variant}`);
    logger.result(`resumed memory triples=${String(freshMemory.size)}`);
  }
} else {
  logger.result('cancellation-run completed before cursor; no checkpoint needed');
}
// #endregion resume-run
