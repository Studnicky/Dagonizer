/**
 * rankCandidates — hybrid (deterministic + LLM tiebreak) ranking node.
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
 *   3. LLM tiebreak — when the top-3 are within 0.10 of each other,
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

import type { Embedder } from '@noocodex/dagonizer/contracts';

import type { Candidate } from '../entities/Book.ts';

import type { ArchivistNode } from './ArchivistNode.ts';

import { BackoffStrategy, RetryPolicy } from '@noocodex/dagonizer/runtime';

// #region rank-retry
/**
 * RetryPolicy for transient LLM tiebreak failures. Schema-violation or
 * network errors retry up to 2 times before falling through to the
 * deterministic order (acceptable degradation — the visitor still sees
 * a sensibly ranked list).
 */
const rankRetry = new RetryPolicy({
  "maxAttempts": 2,
  "strategy":    BackoffStrategy.EXPONENTIAL,
  "baseDelay":   400,
});
// #endregion rank-retry

/**
 * Per-node timeout — generous for Gemini Nano's batch-scoring path.
 * The hybrid path normally finishes in a few hundred ms (no LLM call when
 * top-3 are not tied). LLM tiebreak still wraps in an AbortController
 * merged with `context.signal`.
 */
export const RANK_TIMEOUT_MS = 30_000;

/** Composite score weights — sum to 1.00 (plus the +0.05 memory bonus). */
const W_COSINE   = 0.50;
const W_JACCARD  = 0.25;
const W_SOURCE   = 0.15;
const W_RECENCY  = 0.10;
const MEMORY_BONUS = 0.05;

/** Tie window for LLM tiebreak — top-3 within this score range trigger the LLM. */
const TIE_WINDOW = 0.10;

/** Source-priority lookup table — higher = stronger catalog signal. */
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

/** Recency window — books first published within the last N years earn the bonus. */
const RECENCY_WINDOW_YEARS = 30;

function sourcePriority(source: string): number {
  const key = source.toLowerCase();
  return SOURCE_PRIORITY[key] ?? 0.5;
}

function tokenise(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersect = 0;
  for (const tok of a) if (b.has(tok)) intersect++;
  const union = a.size + b.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Hybrid composite scorer. Pure function — given the inputs, the output
 * is deterministic and unit-testable.
 */
export function compositeScore(
  candidate: Candidate,
  queryVec: readonly number[] | null,
  titleVec: readonly number[] | null,
  termTokens: Set<string>,
  currentYear: number,
): number {
  const titleTokens = tokenise(candidate.book.title);
  const jac = jaccard(titleTokens, termTokens);

  const cos = (queryVec !== null && titleVec !== null)
    ? cosineSimilarity(queryVec, titleVec)
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

  const srcTerm = sourcePriority(candidate.source) * W_SOURCE;

  const year = candidate.book.firstPublishYear;
  const recTerm = (typeof year === 'number' && year >= currentYear - RECENCY_WINDOW_YEARS)
    ? W_RECENCY
    : 0;

  const memBonus = candidate.notes?.['fromPriorMemory'] === true ? MEMORY_BONUS : 0;

  return cosTerm + jacTerm + srcTerm + recTerm + memBonus;
}

interface ScoredEntry {
  readonly candidate: Candidate;
  readonly score: number;
  readonly titleEmbedding: readonly number[] | null;
}

/**
 * Embed every candidate title via the embedder, returning a parallel
 * array of vectors. Reuses `candidate.notes.titleEmbedding` when present
 * so re-ranks across nodes don't re-embed.
 *
 * Any throw bubbles up and is caught by the caller — the deterministic
 * ranker continues with `titleEmbeddings = null` (Jaccard takes the
 * whole weight via the redistribution branch above).
 */
async function embedTitles(
  embedder: Embedder,
  candidates: readonly Candidate[],
): Promise<readonly (readonly number[] | null)[]> {
  const out: (readonly number[] | null)[] = [];
  for (const c of candidates) {
    const cached = c.notes?.['titleEmbedding'];
    if (Array.isArray(cached) && cached.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      out.push(cached as readonly number[]);
      continue;
    }
    out.push(await embedder.embed(c.book.title));
  }
  return out;
}

export const rankCandidates: ArchivistNode<'ranked'> = {
  'name':    'rank-candidates',
  'kind':    'non-deterministic',
  'outputs': ['ranked'],
  async execute(state, context) {
    if (state.candidates.length === 0) {
      context.services.logger.info('rank-candidates: no candidates to rank');
      return { 'output': 'ranked' };
    }

    const controller = new AbortController();
    const handle = setTimeout(() => controller.abort(new Error('node-timeout')), RANK_TIMEOUT_MS);
    const signal = AbortSignal.any([context.signal, controller.signal]);

    try {
      const embedder = context.services.embedder;
      const queryText = state.terms.length > 0 ? state.terms.join(' ') : state.query;
      const termTokens = tokenise(queryText);
      const currentYear = new Date().getFullYear();

      // ── Step 1: Embed query + candidate titles (best-effort) ────────────
      let queryVec: readonly number[] | null = null;
      let titleVecs: readonly (readonly number[] | null)[] = state.candidates.map(() => null);
      if (embedder !== null) {
        try {
          queryVec  = await embedder.embed(queryText);
          titleVecs = await embedTitles(embedder, state.candidates);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          context.services.logger.warn(`rank-candidates: embedder threw, dropping cosine term: ${message}`);
          queryVec  = null;
          titleVecs = state.candidates.map(() => null);
        }
      }

      // ── Step 2: Deterministic composite scoring ─────────────────────────
      const scored: ScoredEntry[] = state.candidates.map((candidate, i) => ({
        candidate,
        'score':          compositeScore(candidate, queryVec, titleVecs[i] ?? null, termTokens, currentYear),
        'titleEmbedding': titleVecs[i] ?? null,
      }));
      scored.sort((a, b) => b.score - a.score);

      // ── Step 3: LLM tiebreak on the top-3 when scores are within ε ──────
      let llmTiebreaks = 0;
      const top3 = scored.slice(0, 3);
      const needsTiebreak = top3.length === 3 &&
        (top3[0]!.score - top3[2]!.score) <= TIE_WINDOW;

      if (needsTiebreak) {
        try {
          const tiebreakCandidates = top3.map((s) => s.candidate);
          const llmScored = await rankRetry.run(
            () => context.services.llm.rankCandidates(state.query, tiebreakCandidates, signal),
            signal,
          );
          // Use the LLM's ordering for the top-3 ONLY; keep the rest in
          // deterministic order. Match LLM-returned candidates back to
          // ScoredEntry by ISBN so we preserve composite scores in logs.
          const byIsbn = new Map<string, ScoredEntry>();
          for (const entry of top3) byIsbn.set(entry.candidate.book.isbn, entry);

          const reorderedTop: ScoredEntry[] = [];
          for (const ls of llmScored) {
            const found = byIsbn.get(ls.candidate.book.isbn);
            if (found !== undefined) reorderedTop.push(found);
          }
          // Defensive: if the LLM dropped one (schema drift), fall back.
          if (reorderedTop.length === 3) {
            scored.splice(0, 3, ...reorderedTop);
            llmTiebreaks = 3;
          }
        } catch (err) {
          // Salvage — keep deterministic order.
          const message = err instanceof Error ? err.message : String(err);
          context.services.logger.info(`rank-candidates: tiebreak fell back to deterministic order (${message})`);
        }
      }

      // ── Emit ranked candidates with composite scores + cached embeddings ─
      const ranked: Candidate[] = scored.map((entry) => {
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

      const top = ranked[0];
      context.services.logger.info(
        `rank-candidates: hybrid (${String(scored.length)} deterministic, ${String(llmTiebreaks)} LLM-tiebreaks); top: ${top !== undefined ? `"${top.book.title}" score=${top.score.toFixed(3)}` : 'none'}`,
      );
    } catch (err) {
      const isAbort =
        (err instanceof DOMException && err.name === 'AbortError') ||
        (err instanceof Error && /aborted|timeout/iu.test(err.message));

      if (isAbort) {
        context.services.logger.info(
          `rank-candidates: timed out, falling through with ${String(state.candidates.length)} unranked candidates`,
        );
      } else {
        state.collectError({
          'code':        'RANK_FAILED',
          'message':     err instanceof Error ? err.message : String(err),
          'operation':   'rank-candidates',
          'recoverable': true,
          'timestamp':   new Date().toISOString(),
        });
        context.services.logger.warn(`rank-candidates failed: ${String(err)}`);
      }
    } finally {
      clearTimeout(handle);
    }
    return { 'output': 'ranked' };
  },
};
