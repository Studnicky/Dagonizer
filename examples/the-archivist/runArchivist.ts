/**
 * runArchivist — end-to-end demo runner (CLI).
 *
 * Wires the registered nodes onto a `Dagonizer<ArchivistState, ArchivistServices>`,
 * registers the canonical DAG (and its sub-DAG components), and runs one
 * visitor question through.
 *
 * Molecular sub-DAG registration order:
 *   1. registerBookSearchFanoutNodes(dispatcher) — registers all nodes used by
 *      the book-search-fanout sub-DAG (extract, decide, scouts, rank, merge, ...)
 *   2. dispatcher.registerDAG(BookSearchFanoutDAG) — registers the sub-DAG itself
 *   3. registerComposeRetryLoopNodes(dispatcher) — compose, validate, respond
 *   4. dispatcher.registerDAG(ComposeRetryLoopDAG) — registers the compose sub-DAG
 *   5. dispatcher.registerDAG(archivistDAG) — registers the parent (references sub-DAGs by name)
 *
 * LLM resolved by the provider matrix: Gemini Nano (only in a browser),
 * Gemini REST (free tier, `GEMINI_API_KEY` env), WebLLM (only in a
 * browser), Stub (CLI fallback so this script always runs). The
 * browser runner refuses to start without a real model; the CLI keeps
 * the stub so tooling / smoke tests work offline.
 *
 * Run:  npx tsx examples/the-archivist/runArchivist.ts
 */

import { ArchivistState } from './ArchivistState.ts';
import { archivistDAG } from './dag.ts';
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
import {
  GeminiApiAdapter,
  StubAdapter,
} from './providers/adapters/index.ts';
import { BaseLlmClient } from './providers/BaseLlmClient.ts';
import type { ArchivistServices, LlmClient } from './services.ts';
import {
  BookSearchFanoutDAG,
  registerBookSearchFanoutNodes,
} from './subdags/BookSearchFanoutDAG.ts';
import {
  ComposeRetryLoopDAG,
  registerComposeRetryLoopNodes,
} from './subdags/ComposeRetryLoopDAG.ts';
import { GoogleBooksTool } from './tools/GoogleBooksTool.ts';
import { OpenLibrarySearchTool } from './tools/OpenLibrarySearchTool.ts';
import { SubjectSearchTool } from './tools/SubjectSearchTool.ts';
import { WikipediaSummaryTool } from './tools/WikipediaSummaryTool.ts';

import { Dagonizer } from '@noocodex/dagonizer';

const logger = new ConsoleLogger();

// ── Backend: Gemini REST when a key is set, stub otherwise. The browser
//    runner refuses to start without a real model; the CLI keeps the
//    stub so smoke tests + dry runs work offline.
const apiKey = typeof process !== 'undefined' ? process.env['GEMINI_API_KEY'] : undefined;
const llm: LlmClient = apiKey !== undefined && apiKey.length > 0
  ? new BaseLlmClient(new GeminiApiAdapter({ 'apiKey': apiKey }))
  : new BaseLlmClient(new StubAdapter());
logger.info(`backend: ${apiKey !== undefined && apiKey.length > 0 ? 'Gemini REST' : 'Stub (CLI)'}`);

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

// ── Sub-DAG node registration (molecular pattern) ────────────────────────
// Each sub-DAG module exports a registerXxxNodes helper that registers
// the nodes it needs. Call it before registerDAG so the validator can
// resolve all node references when the DAG is registered.
registerBookSearchFanoutNodes(dispatcher);
dispatcher.registerDAG(BookSearchFanoutDAG);

registerComposeRetryLoopNodes(dispatcher);
dispatcher.registerDAG(ComposeRetryLoopDAG);

// ── Parent-DAG-only nodes (not used by sub-DAGs) ─────────────────────────
for (const node of [
  recallContext,
  classifyIntent,
  // Inlined branch nodes (reviews + describe) — not in the sub-DAGs
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
// Checkpoint.from to persist and resume in a later process.
if (cancelResult.cursor !== null) {
  logger.result(`stopped at ${cancelResult.cursor} — resumable`);
}
// #endregion cancellation-run
