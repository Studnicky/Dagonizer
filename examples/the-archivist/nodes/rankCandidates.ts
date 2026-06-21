/**
 * rankCandidates: hybrid (deterministic + LLM tiebreak) ranking node.
 *
 * The previous implementation handed every candidate to the LLM and
 * used its ordering wholesale. That cost one LLM call per turn on Nano
 * (slow, sometimes flaky on structured output) and the LLM had no
 * principled view of source quality, recency, or prior-memory weight.
 *
 * The new pipeline:
 *
 *   1. Deterministic composite score per candidate
 *        cosineSim(title, query)  × 0.50  (when embedder reachable)
 *        jaccard(title, terms)    × 0.25
 *        sourcePriority           × 0.15
 *        recencyBonus             × 0.10
 *        +0.05 for fromPriorMemory candidates
 *   2. Sort descending by composite.
 *   3. LLM tiebreak: when the top-3 are within 0.10 of each other,
 *      hand ONLY those 3 candidates to the LLM and use its ordering for
 *      them. Keep the rest in deterministic order. Soft timeout on the
 *      tiebreak: any failure / abort falls through to deterministic order.
 *
 * Embeddings: each candidate's title embedding is computed once and
 * cached on `candidate.notes.titleEmbedding` so rank → recall → validate
 * can reuse the vector across nodes. The query embedding is computed
 * once at the top of the node.
 *
 * Output route is always 'ranked'. mergeCandidates then takes the top-K.
 */

import { NodeErrorBuilder, NodeOutputBuilder, ScalarNode } from '@studnicky/dagonizer';
import type { NodeContextType, SchemaObjectType } from '@studnicky/dagonizer';

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
  static sourcePriority(source: string): number {
    const key = source.toLowerCase();
    return SOURCE_PRIORITY[key] ?? 0.5;
  }

  /**
   * Embed every candidate title via the embedder, returning a parallel
   * array of vectors. Reuses `candidate.notes.titleEmbedding` when present
   * so re-ranks across nodes don't re-embed.
   *
   * Any throw bubbles up and is caught by the caller; the deterministic
   * ranker continues with `titleEmbeddings = null` (Jaccard takes the
   * whole weight via the redistribution branch above).
   */
  static async embedTitles(
    embedder: EmbedderInterface,
    candidates: readonly CandidateType[],
  ): Promise<readonly (readonly number[] | null)[]> {
    const out: (readonly number[] | null)[] = [];
    for (const c of candidates) {
      const cached = c.notes?.['titleEmbedding'];
      if (Array.isArray(cached) && cached.every((n) => typeof n === 'number' && Number.isFinite(n))) {
        out.push(cached as readonly number[]);
        continue;
      }
      out.push(await embedder.embed(c.book.identity.title));
    }
    return out;
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
  readonly titleEmbedding: readonly number[] | null;
}

export class RankCandidatesNode extends ScalarNode<ArchivistState, 'ranked' | 'retry' | 'salvage', ArchivistServices> {
  readonly name = 'rank-candidates';
  readonly outputs = ['ranked', 'retry', 'salvage'] as const;
  override get outputSchema(): Record<'ranked' | 'retry' | 'salvage', SchemaObjectType> {
    return {
      'ranked':  { 'type': 'object' },
      'retry':   { 'type': 'object' },
      'salvage': { 'type': 'object' },
    };
  }

  protected override async executeOne(state: ArchivistState, context: NodeContextType<ArchivistServices>) {
    if (state.candidates.length === 0) {
      state.clearAttempts(context.nodeName);
      return NodeOutputBuilder.of('ranked');
    }

    const controller = new AbortController();
    const handle = setTimeout(() => controller.abort(new Error('node-timeout')), context.services.nodeTimeouts[context.nodeName] ?? RANK_TIMEOUT_MS);
    const signal = AbortSignal.any([context.signal, controller.signal]);

    try {
      const embedder = context.services.embedder;
      const queryText = state.terms.length > 0 ? state.terms.join(' ') : state.query;
      const termTokens = TextSimilarity.tokenise(queryText);
      const currentYear = new Date().getFullYear();

      // ── Step 1: Embed query + candidate titles (best-effort) ────────────
      let queryVec: readonly number[] | null = null;
      let titleVecs: readonly (readonly number[] | null)[] = state.candidates.map(() => null);
      if (embedder !== null) {
        try {
          queryVec  = await embedder.embed(queryText);
          titleVecs = await CandidateScorer.embedTitles(embedder, state.candidates);
        } catch {
          // Embedder threw: drop the cosine term and fall back to the
          // deterministic composite score for every candidate.
          queryVec  = null;
          titleVecs = state.candidates.map(() => null);
        }
      }

      // ── Step 2: Deterministic composite scoring ─────────────────────────
      const scored: ScoredEntry[] = state.candidates.map((candidate, i) => ({
        candidate,
        'score':          CandidateScorer.compositeScore(candidate, queryVec, titleVecs[i] ?? null, termTokens, currentYear),
        'titleEmbedding': titleVecs[i] ?? null,
      }));
      scored.sort((a, b) => b.score - a.score);

      // ── Step 3: LLM tiebreak on the top-3 when scores are within ε ──────
      const top3 = scored.slice(0, 3);
      const needsTiebreak = top3.length === 3 &&
        (top3[0]!.score - top3[2]!.score) <= TIE_WINDOW;

      if (needsTiebreak) {
        try {
          const tiebreakCandidates = top3.map((s) => s.candidate);
          const llmScored = await context.services.llm.rankCandidates(state.query, tiebreakCandidates, signal);
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
          }
        } catch {
          // Salvage: the tiebreak call failed; keep the deterministic order.
        }
      }

      // ── Emit ranked candidates with composite scores + cached embeddings ─
      const ranked: CandidateType[] = scored.map((entry) => {
        const baseNotes: Record<string, unknown> = entry.candidate.notes !== undefined
          ? { ...entry.candidate.notes }
          : {};
        if (entry.titleEmbedding !== null) {
          baseNotes['titleEmbedding'] = entry.titleEmbedding;
        }
        baseNotes['compositeScore'] = entry.score;
        return {
          ...entry.candidate,
          'score': entry.score,
          'notes': baseNotes,
        };
      });
      state.candidates = ranked;

      state.clearAttempts(context.nodeName);
      return NodeOutputBuilder.of('ranked');
    } catch (err) {
      // External cancellation / run deadline propagates unchanged.
      if (context.signal.aborted) throw err;
      // Node-local timeout or unexpected failure → retry budget decides the
      // flow. Emitting the candidates as "ranked" when ranking never completed
      // would be a fabricated result; rank-candidates-salvage owns the
      // deterministic-passthrough recovery.
      state.collectError(NodeErrorBuilder.from(
        'RANK_FAILED',
        err instanceof Error ? err.message : String(err),
        'rank-candidates',
        true,
        new Date().toISOString(),
      ));
      if (state.withinRetryBudget(context.nodeName, RETRY_BUDGET)) {
        return NodeOutputBuilder.of('retry');
      }
      state.clearAttempts(context.nodeName);
      return NodeOutputBuilder.of('salvage');
    } finally {
      clearTimeout(handle);
    }
  }
}

/** Singleton node instance referenced by the DAG wiring. */
export const rankCandidates = new RankCandidatesNode();
