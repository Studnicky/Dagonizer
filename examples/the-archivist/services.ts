/**
 * ArchivistServices: the dispatcher's services bag.
 *
 * The Archivist does not cheat with hand-crafted in-process catalogs.
 * Every candidate comes from an authoritative source (the OpenLibrary
 * tool, real web data) and every score is assigned by the LLM after
 * inspecting the candidate's metadata against the visitor's question.
 *
 *   webSearch:  the only data-acquisition tool. CORS-friendly,
 *                key-free OpenLibrary API. The LLM decides when to
 *                call it via `decideTools`; the named scouts
 *                (`open-library-scout` et al.) actually execute it.
 *   memory:     n3.js triple store; nodes write findings, gate nodes
 *                ASK the store.
 *   llm:        the brain. Decides tools, ranks candidates, composes
 *                and validates the response.
 *   logger:     Node stdout + browser observable stream.
 */

import type { ConversationTurn, MemoryDigest } from './ArchivistState.ts';
import type { CandidateType } from './entities/Book.ts';
import type { MemoryStore } from './memory/MemoryStore.ts';
import type { EmbedderInterface } from '@studnicky/dagonizer/contracts';
import type { ToolInterface } from '@studnicky/dagonizer/tool';

/**
 * WebSearchTool: adapter contract for the live-web book search.
 * Concrete instance lives in `tools/OpenLibrarySearchTool.ts` and runs
 * unmodified in Node and in the browser (OpenLibrary serves CORS).
 */
export type WebSearchTool = ToolInterface<{ query: string; limit?: number } & Record<string, unknown>, readonly CandidateType[]>;

/** One candidate with the LLM's chosen score (0..1). */
export interface ScoredCandidate {
  readonly candidate: CandidateType;
  readonly score:     number;
  readonly reason?:   string;
  /**
   * Freeform key/value metadata the LLM attached via the
   * `additionalProperties: true` channel on the ranking schema,
   * e.g. `{ vibe: 'liminal', confidence: 0.85, themes: [...] }`.
   */
  readonly notes?:    Readonly<Record<string, unknown>>;
}

/**
 * Every intent the classifier may emit. The four broad intents
 * (`search` / `describe` / `recommend` / `off-topic`) drive the
 * general pipeline; the four specific intents (`lookup-author` /
 * `find-reviews` / `describe-book` / `recommend-similar`) each route
 * to a dedicated embedded-DAG branch. `recall-memories` is the
 * meta-query intent: the visitor asked what the agent has
 * seen/remembered across sessions.
 */
export type ClassifiedIntent =
  | 'lookup-author'
  | 'find-reviews'
  | 'describe-book'
  | 'recommend-similar'
  | 'recall-memories'
  | 'search'
  | 'describe'
  | 'recommend'
  | 'off-topic';

export interface LlmClientInterface {
  /**
   * Classify the visitor's question into one of the supported intents.
   * The optional `recalledSummary` is a 1–2 sentence hint from the
   * recallContext node, injected into the prompt when non-empty so the
   * classifier benefits from prior-session continuity.
   * The optional `signal` is forwarded to the adapter so the underlying
   * fetch / `LanguageModelSession.prompt` is cancelled on timeout or abort.
   */
  classifyIntent(query: string, recalledSummary?: string, conversation?: readonly ConversationTurn[], signal?: AbortSignal): Promise<ClassifiedIntent>;
  /**
   * Extract structured search terms from a free-text question.
   * The optional `signal` is forwarded to the adapter.
   */
  extractTerms(query: string, signal?: AbortSignal): Promise<readonly string[]>;
  /**
   * Decide which tools (if any) to invoke for this query; driven
   * through the adapter's native tool channel (Gemini's
   * `functionDeclarations`, Nano's `responseConstraint`, etc.).
   * The optional `signal` is forwarded to the adapter so Nano's
   * `responseConstraint` invocation is cancelled on timeout.
   */
  decideTools(
    query: string,
    available: readonly { name: string; description: string; inputSchema: Record<string, unknown> }[],
    signal?: AbortSignal,
  ): Promise<readonly { name: string; arguments: Record<string, unknown> }[]>;
  /**
   * Rank candidates by relevance to the query. The LLM assigns each
   * candidate a score in [0, 1]; there are no hand-crafted score
   * floors; the model is the ranker.
   *
   * `signal` is optional and forwarded to the adapter's `ChatRequestType`.
   * When the node's `context.signal` is already aborted the adapter
   * short-circuits via `AbortSignal.any` before making the network call.
   */
  rankCandidates(query: string, candidates: readonly CandidateType[], signal?: AbortSignal): Promise<readonly ScoredCandidate[]>;
  /**
   * Compose a prose response from a shortlist of candidates. The
   * optional `priorContext` carries facts the agent should reference
   * if appropriate, e.g. previous visitor queries, previously
   * recommended titles. The LLM may use this to weave continuity
   * commentary ("Last visit you asked about cosmic horror; now…").
   * The optional `recalledSummary` is a 1–2 sentence hint from the
   * recallContext node injected when non-empty for session continuity.
   */
  compose(
    query: string,
    shortlist: readonly CandidateType[],
    priorContext?: readonly { kind: string; text: string }[],
    recalledSummary?: string,
    conversation?: readonly ConversationTurn[],
    signal?: AbortSignal,
  ): Promise<string>;
  /** Author-survey compose: chronological body-of-work prose. */
  composeAuthor(
    query: string,
    shortlist: readonly CandidateType[],
    priorContext?: readonly { kind: string; text: string }[],
    recalledSummary?: string,
    conversation?: readonly ConversationTurn[],
    signal?: AbortSignal,
  ): Promise<string>;
  /** Reviews compose: weight ratings (notes.rating / notes.ratingsCount). */
  composeReviews(
    query: string,
    shortlist: readonly CandidateType[],
    priorContext?: readonly { kind: string; text: string }[],
    recalledSummary?: string,
    conversation?: readonly ConversationTurn[],
    signal?: AbortSignal,
  ): Promise<string>;
  /** Describe a single title; no recommendations. */
  describeBook(
    query: string,
    shortlist: readonly CandidateType[],
    priorContext?: readonly { kind: string; text: string }[],
    recalledSummary?: string,
    conversation?: readonly ConversationTurn[],
    signal?: AbortSignal,
  ): Promise<string>;
  /** Recommend similar: anchored on persistent memory. */
  composeSimilar(
    query: string,
    shortlist: readonly CandidateType[],
    priorContext?: readonly { kind: string; text: string }[],
    recalledSummary?: string,
    conversation?: readonly ConversationTurn[],
    signal?: AbortSignal,
  ): Promise<string>;
  /** Validate a draft against quality rules (length, citations, tone). */
  validate(draft: string, shortlist: readonly CandidateType[]): Promise<boolean>;
  /**
   * Compose a friendly prose response listing what the Archivist
   * remembers. `digest` is the structured roll-up from `recallMemories`;
   * `recalledSummary` is the optional 1–2 sentence hint from
   * `recallContext`. When the digest is empty (bookCount === 0) the
   * response gracefully says the shelves are fresh.
   */
  composeMemoryRecall(
    query: string,
    digest: MemoryDigest,
    recalledSummary?: string,
    conversation?: readonly ConversationTurn[],
    signal?: AbortSignal,
  ): Promise<string>;
  /**
   * Compose an in-character failure response when all scouts returned
   * empty. `failureCause` is a sanitized one-liner summary accumulated
   * by the scouts. The response acknowledges what was searched, explains
   * the gap, and offers one concrete next step; never silent-fails.
   */
  composeEmptyResponse(query: string, failureCause: string, conversation?: readonly ConversationTurn[], signal?: AbortSignal): Promise<string>;
  /**
   * Generate a short, curious visitor-style question about a popular
   * book, author, or series; used to pre-fill the input on a fresh
   * session before the visitor types anything. Returns a single
   * question under 20 words. No preamble.
   */
  suggestStarterQuery(): Promise<string>;
  /**
   * Generate a fresh, in-character Archivist greeting for a new
   * session. Returns a single sentence under 30 words. Warm, curious,
   * librarian voice. No negative framing.
   */
  suggestGreeting(): Promise<string>;
  /**
   * Generate a natural first visitor message that reads as a reply to
   * the supplied greeting. Returns a single sentence under 30 words
   * that feels like something a real bookshop visitor would say.
   */
  suggestVisitorReplyTo(greeting: string): Promise<string>;
  /**
   * Generate a plain-English explanation of a tool or DAG node for the
   * "explain" side-panel in the live demo. `name` is the tool/node key;
   * `context` is a one-sentence static description of what it does.
   * Returns 2–3 sentences covering what it does, why it matters, and
   * one concrete example. Under 80 words. No preamble.
   */
  explainTool(name: string, context: string): Promise<string>;
}

/**
 * GoogleBooksTool: adapter contract for Google Books v1 volume search.
 * Concrete instance lives in `tools/GoogleBooksTool.ts`. Each returned
 * `Candidate` carries `notes.rating` and `notes.ratingsCount` when the
 * source had them; the `find-reviews` branch weights those during compose
 * via the `weightRatings` directive.
 */
export type GoogleBooksToolContract = ToolInterface<{ query: string; maxResults?: number } & Record<string, unknown>, readonly CandidateType[]>;

/**
 * WikipediaSummaryTool: adapter contract for the Wikipedia REST
 * `page/summary` enrichment source. Concrete instance lives in
 * `tools/WikipediaSummaryTool.ts`. Returns one `Candidate` per query
 * keyed by a work URN or `urn:wiki:<title>`; `CanonicalId.dedupe` folds
 * it into the candidate stream at merge time.
 */
export type WikipediaSummaryToolContract = ToolInterface<{ query: string } & Record<string, unknown>, readonly CandidateType[]>;

/**
 * SubjectSearchTool: adapter contract for the OpenLibrary subject/theme
 * search. Concrete instance lives in `tools/SubjectSearchTool.ts`. The
 * `subject_search` tool lets visitors locate books by thematic content
 * (e.g. "labyrinth", "haunted house") rather than by title or author.
 */
export type SubjectSearchToolContract = ToolInterface<{ subject: string; limit?: number } & Record<string, unknown>, readonly CandidateType[]>;

// #region services-shape
export interface ArchivistServices {
  readonly webSearch: WebSearchTool;
  readonly googleBooks: GoogleBooksToolContract;
  readonly wikipediaSummary: WikipediaSummaryToolContract;
  readonly subjectSearch: SubjectSearchToolContract;
  readonly llm: LlmClientInterface;
  /**
   * RDF triple store (n3.js in-memory). Per-run scratchpad: memory
   * nodes write findings; gate nodes ASK the store; the live UI panel
   * mirrors the triples so the visitor can watch the graph grow.
   */
  readonly memory: MemoryStore;
  /**
   * Optional embedder service for cosine-similarity recall and hybrid
   * ranking. Resolved at runtime via `EmbedderCascade.select()`. Set to
   * `null` when no embedder is reachable (browser without Ollama, no
   * API keys, etc.); every consumer is required to handle this
   * gracefully and fall back to deterministic Jaccard / heuristics.
   * Explicit-null sentinel (not optional) keeps V8 hidden-class stability.
   */
  readonly embedder: EmbedderInterface | null;
  /**
   * Per-placement deadline overrides in milliseconds, keyed by node/placement
   * name (`context.nodeName`). Empty map ⇒ every node uses its built-in
   * default. The live demo wires this from the TimeoutPane sliders.
   */
  readonly nodeTimeouts: Readonly<Record<string, number>>;
  readonly logger: { info(message: string): void; warn(message: string): void };
}
// #endregion services-shape
