/**
 * ArchivistServices — the dispatcher's services bag.
 *
 * The Archivist does not cheat with hand-crafted in-process catalogs.
 * Every candidate comes from an authoritative source (the OpenLibrary
 * tool, real web data) and every score is assigned by the LLM after
 * inspecting the candidate's metadata against the visitor's question.
 *
 *   webSearch  — the only data-acquisition tool. CORS-friendly,
 *                key-free OpenLibrary API. The LLM decides when to
 *                call it via `decideTools`; web-search-scout actually
 *                executes it.
 *   memory     — n3.js triple store; nodes write findings, gate nodes
 *                ASK the store.
 *   llm        — the brain. Decides tools, ranks candidates, composes
 *                + validates the response.
 *   logger     — Node stdout + browser observable stream.
 */

import type { Candidate } from './entities/Book.ts';
import type { MemoryStore } from './memory/MemoryStore.ts';
import type { Tool } from './tools/ToolDefinition.ts';

/**
 * WebSearchTool — adapter contract for the live-web book search.
 * Concrete instance lives in `tools/OpenLibrarySearchTool.ts` and runs
 * unmodified in Node and in the browser (OpenLibrary serves CORS).
 */
export type WebSearchTool = Tool<{ query: string; limit?: number } & Record<string, unknown>, readonly Candidate[]>;

/** One candidate with the LLM's chosen score (0..1). */
export interface ScoredCandidate {
  readonly candidate: Candidate;
  readonly score:     number;
  readonly reason?:   string;
  /**
   * Freeform key/value metadata the LLM attached via the
   * `additionalProperties: true` channel on the ranking schema —
   * e.g. `{ vibe: 'liminal', confidence: 0.85, themes: [...] }`.
   */
  readonly notes?:    Readonly<Record<string, unknown>>;
}

/**
 * Every intent the classifier may emit. The four "legacy" intents
 * (`search` / `describe` / `recommend` / `off-topic`) drive the original
 * pipeline; the four newer intents (`lookup-author` / `find-reviews` /
 * `describe-book` / `recommend-similar`) each route to a dedicated
 * sub-DAG branch.
 */
export type ClassifiedIntent =
  | 'lookup-author'
  | 'find-reviews'
  | 'describe-book'
  | 'recommend-similar'
  | 'search'
  | 'describe'
  | 'recommend'
  | 'off-topic';

export interface LlmClient {
  /** Classify the visitor's question into one of the supported intents. */
  classifyIntent(query: string): Promise<ClassifiedIntent>;
  /** Extract structured search terms from a free-text question. */
  extractTerms(query: string): Promise<readonly string[]>;
  /**
   * Decide which tools (if any) to invoke for this query — driven
   * through the adapter's native tool channel (Gemini's
   * `functionDeclarations`, Nano's `responseConstraint`, etc.).
   */
  decideTools(
    query: string,
    available: readonly { name: string; description: string; inputSchema: Record<string, unknown> }[],
  ): Promise<readonly { name: string; arguments: Record<string, unknown> }[]>;
  /**
   * Rank candidates by relevance to the query. The LLM assigns each
   * candidate a score in [0, 1] — there are no hand-crafted score
   * floors; the model is the ranker.
   */
  rankCandidates(query: string, candidates: readonly Candidate[]): Promise<readonly ScoredCandidate[]>;
  /**
   * Compose a prose response from a shortlist of candidates. The
   * optional `priorContext` carries facts the agent should reference
   * if appropriate — e.g. previous visitor queries, previously
   * recommended titles. The LLM may use this to weave continuity
   * commentary ("Last visit you asked about cosmic horror; now…").
   */
  compose(
    query: string,
    shortlist: readonly Candidate[],
    priorContext?: readonly { kind: string; text: string }[],
  ): Promise<string>;
  /** Author-survey compose — chronological body-of-work prose. */
  composeAuthor(
    query: string,
    shortlist: readonly Candidate[],
    priorContext?: readonly { kind: string; text: string }[],
  ): Promise<string>;
  /** Reviews compose — weight ratings (notes.rating / notes.ratingsCount). */
  composeReviews(
    query: string,
    shortlist: readonly Candidate[],
    priorContext?: readonly { kind: string; text: string }[],
  ): Promise<string>;
  /** Describe a single title — no recommendations. */
  describeBook(
    query: string,
    shortlist: readonly Candidate[],
    priorContext?: readonly { kind: string; text: string }[],
  ): Promise<string>;
  /** Recommend similar — anchored on persistent memory. */
  composeSimilar(
    query: string,
    shortlist: readonly Candidate[],
    priorContext?: readonly { kind: string; text: string }[],
  ): Promise<string>;
  /** Validate a draft against quality rules (length, citations, tone). */
  validate(draft: string, shortlist: readonly Candidate[]): Promise<boolean>;
}

/**
 * GoogleBooksTool — adapter contract for Google Books v1 volume search.
 * Concrete instance lives in `tools/GoogleBooksTool.ts`. Each returned
 * `Candidate` carries `notes.rating` and `notes.ratingsCount` when the
 * source had them; the `find-reviews` branch weights those during compose
 * via the `weightRatings` directive.
 */
export type GoogleBooksToolContract = Tool<{ query: string; maxResults?: number } & Record<string, unknown>, readonly Candidate[]>;

/**
 * WikipediaSummaryTool — adapter contract for the Wikipedia REST
 * `page/summary` enrichment source. Concrete instance lives in
 * `tools/WikipediaSummaryTool.ts`. Returns one `Candidate` per query
 * keyed by a work URN or `urn:wiki:<title>`; `CanonicalId.dedupe` folds
 * it into the candidate stream at merge time.
 */
export type WikipediaSummaryToolContract = Tool<{ query: string } & Record<string, unknown>, readonly Candidate[]>;

export interface ArchivistServices {
  readonly webSearch: WebSearchTool;
  readonly googleBooks: GoogleBooksToolContract;
  readonly wikipediaSummary: WikipediaSummaryToolContract;
  readonly llm: LlmClient;
  /**
   * RDF triple store (n3.js in-memory). Per-run scratchpad: memory
   * nodes write findings; gate nodes ASK the store; the live UI panel
   * mirrors the triples so the visitor can watch the graph grow.
   */
  readonly memory: MemoryStore;
  readonly logger: { info(message: string): void; warn(message: string): void };
}
