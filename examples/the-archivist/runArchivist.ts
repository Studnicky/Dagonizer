/**
 * runArchivist — end-to-end demo runner (CLI).
 *
 * Wires the registered nodes onto a `Dagonizer<ArchivistState, ArchivistServices>`,
 * registers the canonical DAG, and runs one visitor question through.
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
import { composeResponse, validateResponse } from './nodes/composeResponse.ts';
import { decideTools } from './nodes/decideTools.ts';
import { extractQuery } from './nodes/extractQuery.ts';
import { groupByYear } from './nodes/groupByYear.ts';
import { hasCitationsGate } from './nodes/hasCitationsGate.ts';
import { mergeCandidates } from './nodes/mergeCandidates.ts';
import { pickBestMatch } from './nodes/pickBestMatch.ts';
import { rankByRating } from './nodes/rankByRating.ts';
import { rankCandidates } from './nodes/rankCandidates.ts';
import { recallContext }    from './nodes/recallContext.ts';
import { recallPastVisits } from './nodes/recallPastVisits.ts';
import { recommendSimilar } from './nodes/recommendSimilar.ts';
import { recordFindings } from './nodes/recordFindings.ts';
import { declineEmpty, declineOffTopic, respondToVisitor } from './nodes/respondToVisitor.ts';
import { webSearchScout, openLibraryScout, googleBooksScout, subjectScout, wikipediaScout } from './nodes/scouts.ts';
import {
  GeminiApiAdapter,
  StubAdapter,
} from './providers/adapters/index.ts';
import { BaseLlmClient } from './providers/BaseLlmClient.ts';
import type { ArchivistServices, LlmClient } from './services.ts';
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

// ── Dispatcher ───────────────────────────────────────────────────────────
const dispatcher = new Dagonizer<ArchivistState, ArchivistServices>({ services });

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
  rankCandidates,
  rankByRating,
  pickBestMatch,
  mergeCandidates,
  recordFindings,
  hasCitationsGate,
  groupByYear,
  recallPastVisits,
  recommendSimilar,
  composeResponse,
  validateResponse,
  respondToVisitor,
  declineOffTopic,
  declineEmpty,
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
