/**
 * rankCandidates: hybrid deterministic ranking with an LLM tiebreak.
 *
 * Pipeline:
 *
 *   1. Deterministic composite score per candidate
 *        cosineSim(semanticText, query) × 0.50  (when embedder reachable)
 *        jaccard(title, terms)          × 0.25
 *        sourcePriority                 × 0.15
 *        recencyBonus                   × 0.10
 *        +0.05 for fromPriorMemory candidates
 *   2. Sort descending by composite.
 *   3. LLM tiebreak: when the top-3 are within 0.10 of each other,
 *      hand ONLY those 3 candidates to the LLM and use its ordering for
 *      them. Keep the rest in deterministic order. Soft timeout on the
 *      tiebreak: any failure / abort falls through to deterministic order.
 *
 * Embeddings: each candidate is embedded as a rich semantic text string
 * (title + authors + subjects + summary, bounded to 600 chars). Completed
 * vectors live in a bounded node cache and in-flight duplicate embedding
 * requests coalesce per abort signal. Short titles carry too little thematic
 * signal alone; the enriched text improves cosine alignment with thematic
 * queries. The query embedding is computed once at the top of the node.
 *
 * Output route is always 'ranked'. mergeCandidates then takes the top-K.
 */

import { LruCache } from '@studnicky/cache';
import { Coalesce } from '@studnicky/concurrency/coalesce';
import { Batch, BatchItemExecutor, MonadicNode, NodeError, NodeOutput, ReasoningStep, RoutedBatch } from '@studnicky/dagonizer';
import type { ItemType, NodeContextType, SchemaObjectType } from '@studnicky/dagonizer';
import { Signal } from '@studnicky/signal';

import type { EmbedderInterface } from '@studnicky/dagonizer/contracts';

import type { CandidateType } from '../entities/Book.ts';
import type { ArchivistState } from '../ArchivistState.ts';
import type { ArchivistServices } from '../services.ts';
import { TextSimilarity } from './textUtils.ts';

/**
 * Per-node timeout: generous for Gemini Nano's batch-scoring path.
 * The hybrid path normally finishes in a few hundred ms (no LLM call when
 * top-3 are not tied). LLM tiebreak still wraps in an AbortController
 * merged with `context.signal`.
 */
export const RANK_TIMEOUT_MS = 30_000;

/** Total attempts (initial + retries) before routing to salvage. */
const RETRY_BUDGET = 2;

/** Composite score weights: sum to 1.00 (plus the +0.05 memory bonus). */
const W_COSINE   = 0.50;
const W_JACCARD  = 0.25;
const W_SOURCE   = 0.15;
const W_RECENCY  = 0.10;
const MEMORY_BONUS = 0.05;

/** Tie window for LLM tiebreak: top-3 within this score range trigger the LLM. */
const TIE_WINDOW = 0.10;
const SEMANTIC_EMBEDDING_CACHE_CAPACITY = 2_048;
const SEMANTIC_EMBEDDING_CACHE_TTL_MS = 30 * 60 * 1_000;
const SEMANTIC_EMBEDDING_CONCURRENCY = 4;

/** Source-priority lookup table: higher = stronger catalog signal. */
const SOURCE_PRIORITY: Readonly<Record<string, number>> = {
  'openlibrary':       1.0,
  'web-search':        1.0,
  'google-books':      0.9,
  'google_books':      0.9,
  'subject-search':    0.85,
  'subject_search':    0.85,
  'wikipedia':         0.6,
  'wikipedia_summary': 0.6,
  'memory':            0.7,
};

/** Recency window: books first published within the last N years earn the bonus. */
const RECENCY_WINDOW_YEARS = 30;

/**
 * CandidateScorer: pure-function composite scorer for hybrid ranking.
 * Static methods only; no instance state.
 */
export class CandidateScorer {
  /** True when `value` is an array of finite numbers (type predicate for cache validation). */
  static isFiniteNumberArray(value: unknown): value is readonly number[] {
    return Array.isArray(value) && value.every((n) => typeof n === 'number' && Number.isFinite(n));
  }

  static sourcePriority(source: string): number {
    const key = source.toLowerCase();
    return SOURCE_PRIORITY[key] ?? 0.5;
  }

  /**
   * Build a rich semantic text string for a candidate: title + authors +
   * up to 10 subjects + up to 300 chars of summary, joined as a single
   * space-delimited string and bounded to 600 characters total.
   *
   * Short titles (e.g. "Piranesi") carry little thematic signal in isolation.
   * Embedding the enriched text gives the cosine term a far stronger
   * representation for thematic queries like "a strange house and a library".
   */
  static semanticText(candidate: CandidateType): string {
    const parts: string[] = [candidate.book.identity.title];
    const { authors } = candidate.book.identity;
    if (authors.length > 0) parts.push(authors.join(', '));
    const { subjects, summary } = candidate.book.publication;
    if (subjects.length > 0) parts.push(subjects.slice(0, 10).join(', '));
    if (summary !== null && summary.length > 0) parts.push(summary.slice(0, 300));
    return parts.join(' ').slice(0, 600);
  }

  /**
   * Hybrid composite scorer. Pure function: given the inputs, the output
   * is deterministic and unit-testable.
   */
  static compositeScore(
    candidate: CandidateType,
    queryVec: readonly number[] | null,
    titleVec: readonly number[] | null,
    termTokens: Set<string>,
    currentYear: number,
  ): number {
    const titleTokens = TextSimilarity.tokenise(candidate.book.identity.title);
    const jac = TextSimilarity.jaccard(titleTokens, termTokens);

    const cos = (queryVec !== null && titleVec !== null)
      ? TextSimilarity.cosine(queryVec, titleVec)
      : 0;

    // When the embedder isn't reachable for either side, redistribute the
    // cosine weight onto the Jaccard term so the deterministic ranker isn't
    // starved of signal. Total weight stays 1.0.
    const cosTerm = (queryVec !== null && titleVec !== null)
      ? cos * W_COSINE
      : 0;
    const jacTerm = (queryVec !== null && titleVec !== null)
      ? jac * W_JACCARD
      : jac * (W_COSINE + W_JACCARD);

    const srcTerm = CandidateScorer.sourcePriority(candidate.source) * W_SOURCE;

    const year = candidate.book.publication.firstPublishYear;
    const recTerm = (typeof year === 'number' && year >= currentYear - RECENCY_WINDOW_YEARS)
      ? W_RECENCY
      : 0;

    const memBonus = candidate.notes?.['fromPriorMemory'] === true ? MEMORY_BONUS : 0;

    return cosTerm + jacTerm + srcTerm + recTerm + memBonus;
  }
}

interface ScoredEntry {
  readonly candidate: CandidateType;
  readonly score: number;
  readonly semanticEmbedding: readonly number[] | null;
}

export class RankCandidatesNode extends MonadicNode<ArchivistState, 'ranked' | 'retry' | 'salvage'> {
  static readonly #signalIds = new WeakMap<AbortSignal, string>();
  static #nextSignalId = 0;

  private readonly services: ArchivistServices;
  readonly #semanticEmbeddings = LruCache.create<string, readonly number[]>({
    'capacity': SEMANTIC_EMBEDDING_CACHE_CAPACITY,
    'ttlMs':    SEMANTIC_EMBEDDING_CACHE_TTL_MS,
  });
  readonly #embeddingRequests = Coalesce.create<readonly number[]>();

  readonly name = 'rank-candidates';
  readonly outputs = ['ranked', 'retry', 'salvage'] as const;

  constructor(services: ArchivistServices) {
    super();
    this.services = services;
  }
  override get outputSchema(): Record<'ranked' | 'retry' | 'salvage', SchemaObjectType> {
    return {
      'ranked':  { 'type': 'object' },
      'retry':   { 'type': 'object' },
      'salvage': { 'type': 'object' },
    };
  }

  private async embedSemantic(
    embedder: EmbedderInterface,
    candidates: readonly CandidateType[],
    signal: AbortSignal,
  ): Promise<readonly (readonly number[] | null)[]> {
    return BatchItemExecutor.map(
      candidates,
      (candidate) => this.embedSemanticText(embedder, CandidateScorer.semanticText(candidate), signal),
      { 'concurrency': Math.min(SEMANTIC_EMBEDDING_CONCURRENCY, Math.max(candidates.length, 1)) },
      signal,
    );
  }

  private async embedSemanticText(embedder: EmbedderInterface, text: string, signal: AbortSignal): Promise<readonly number[]> {
    const cacheKey = RankCandidatesNode.semanticEmbeddingCacheKey(embedder, text);
    const cached = this.#semanticEmbeddings.get(cacheKey);
    if (cached !== undefined) return cached;

    const requestKey = `${RankCandidatesNode.signalKey(signal)}\u0000${cacheKey}`;
    return this.#embeddingRequests.run(requestKey, async () => {
      const cachedAfterCoalesce = this.#semanticEmbeddings.get(cacheKey);
      if (cachedAfterCoalesce !== undefined) return cachedAfterCoalesce;

      const vector = await embedder.embed(text, { signal });
      this.#semanticEmbeddings.set(cacheKey, vector);
      return vector;
    });
  }

  private static semanticEmbeddingCacheKey(embedder: EmbedderInterface, text: string): string {
    return `${embedder.id}\u0000${embedder.dimensions.toString()}\u0000${text}`;
  }

  private static signalKey(signal: AbortSignal): string {
    const existing = RankCandidatesNode.#signalIds.get(signal);
    if (existing !== undefined) return existing;
    const next = `signal:${RankCandidatesNode.#nextSignalId.toString()}`;
    RankCandidatesNode.#nextSignalId++;
    RankCandidatesNode.#signalIds.set(signal, next);
    return next;
  }

  override async execute(batch: Batch<ArchivistState>, context: NodeContextType) {
    const rankedItems: ItemType<ArchivistState>[] = [];
    const retryItems: ItemType<ArchivistState>[] = [];
    const salvageItems: ItemType<ArchivistState>[] = [];

    for (const item of batch) {
      const { state } = item;
      if (state.candidates.length === 0) {
        state.clearAttempts(context.nodeName);
        const result = NodeOutput.create('ranked');
        for (const error of result.errors) state.collectError(error);
        rankedItems.push(item);
        continue;
      }

      const signal = Signal.compose({
        'deadlineMs': this.services.nodeTimeouts[context.nodeName] ?? RANK_TIMEOUT_MS,
        'signal':     context.signal,
      });

      try {
        const embedder = this.services.embedder;
        const queryText = state.terms.length > 0 ? state.terms.join(' ') : state.query;
        const termTokens = TextSimilarity.tokenise(queryText);
        const currentYear = new Date().getFullYear();

      // ── Step 1: Embed query + candidate semantic texts (best-effort) ────
      let queryVec: readonly number[] | null = null;
      let semanticVecs: readonly (readonly number[] | null)[] = state.candidates.map(() => null);
      if (embedder !== null) {
        try {
          queryVec     = await embedder.embed(queryText, { signal });
          semanticVecs = await this.embedSemantic(embedder, state.candidates, signal);
        } catch {
          // Embedder threw: drop the cosine term and fall back to the
          // deterministic composite score for every candidate.
          queryVec     = null;
          semanticVecs = state.candidates.map(() => null);
        }
      }

      // ── Step 2: Deterministic composite scoring ─────────────────────────
      const scored: ScoredEntry[] = state.candidates.map((candidate, i) => ({
        candidate,
        'score':             CandidateScorer.compositeScore(candidate, queryVec, semanticVecs[i] ?? null, termTokens, currentYear),
        'semanticEmbedding': semanticVecs[i] ?? null,
      }));
      scored.sort((a, b) => b.score - a.score);

      // ── Step 3: LLM tiebreak on the top-3 when scores are within ε ──────
      const top3 = scored.slice(0, 3);
      const top3First = top3[0];
      const top3Third = top3[2];
      const needsTiebreak = top3.length === 3 &&
        top3First !== undefined && top3Third !== undefined &&
        (top3First.score - top3Third.score) <= TIE_WINDOW;

      let llmTiebreakApplied = false;
      if (needsTiebreak) {
        try {
          const tiebreakCandidates = top3.map((s) => s.candidate);
          const llmScored = await this.services.llm.rankCandidates(state.query, tiebreakCandidates, signal);
          // Use the LLM's ordering for the top-3 ONLY; keep the rest in
          // deterministic order. Match LLM-returned candidates back to
          // ScoredEntry by ISBN so we preserve composite scores in logs.
          const byIsbn = new Map<string, ScoredEntry>();
          for (const entry of top3) byIsbn.set(entry.candidate.book.identity.isbn, entry);

          const reorderedTop: ScoredEntry[] = [];
          for (const ls of llmScored) {
            const found = byIsbn.get(ls.candidate.book.identity.isbn);
            if (found !== undefined) reorderedTop.push(found);
          }
          // Defensive: if the LLM dropped one (schema drift), fall back.
          if (reorderedTop.length === 3) {
            scored.splice(0, 3, ...reorderedTop);
            llmTiebreakApplied = true;
          }
        } catch {
          // Salvage: the tiebreak call failed; keep the deterministic order.
        }
      }

      // ── Emit ranked candidates with composite scores ────────────────────
      const ranked: CandidateType[] = scored.map((entry) => {
        const baseNotes: Record<string, unknown> = entry.candidate.notes !== undefined
          ? { ...entry.candidate.notes }
          : {};
        baseNotes['compositeScore'] = entry.score;
        return {
          ...entry.candidate,
          'score': entry.score,
          'notes': baseNotes,
        };
      });
      state.candidates = ranked;

      state.reasoning = [
        ...state.reasoning,
        llmTiebreakApplied
          ? ReasoningStep.create({ 'kind': 'action', 'tool': 'rankCandidates.llmTiebreak', 'args': { 'candidateCount': top3.length } })
          : ReasoningStep.create({ 'kind': 'thought', 'text': 'ranked candidates by deterministic composite score (no LLM tiebreak needed)' }),
      ];

        state.clearAttempts(context.nodeName);
        const result = NodeOutput.create('ranked');
        for (const error of result.errors) state.collectError(error);
        rankedItems.push(item);
      } catch (err) {
        // External cancellation / run deadline propagates unchanged.
        if (context.signal.aborted) throw err;
        // Node-local timeout or unexpected failure -> retry budget decides the
        // flow. Emitting the candidates as "ranked" when ranking never completed
        // would be a fabricated result; rank-candidates-salvage owns the
        // deterministic-passthrough recovery.
        state.collectError(NodeError.create(
          'RANK_FAILED',
          err instanceof Error ? err.message : String(err),
          'rank-candidates',
          true,
          new Date().toISOString(),
        ));
        if (state.withinRetryBudget(context.nodeName, RETRY_BUDGET)) {
          const result = NodeOutput.create('retry');
          for (const error of result.errors) state.collectError(error);
          retryItems.push(item);
        } else {
          state.clearAttempts(context.nodeName);
          const result = NodeOutput.create('salvage');
          for (const error of result.errors) state.collectError(error);
          salvageItems.push(item);
        }
      }
    }

    const routes: Array<readonly ['ranked' | 'retry' | 'salvage', Batch<ArchivistState>]> = [];
    if (rankedItems.length > 0) routes.push(['ranked', Batch.from(rankedItems)]);
    if (retryItems.length > 0) routes.push(['retry', Batch.from(retryItems)]);
    if (salvageItems.length > 0) routes.push(['salvage', Batch.from(salvageItems)]);
    return RoutedBatch.create(routes);
  }
}
