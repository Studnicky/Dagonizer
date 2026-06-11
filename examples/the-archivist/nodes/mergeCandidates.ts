/**
 * mergeCandidates: cross-source dedupe, rank by score, keep top five.
 *
 * Uses `CanonicalId.dedupe` to collapse multi-source hits sharing the
 * same canonical id (ISBN-13 → ISBN-10 → work URN). A book seen by
 * both OpenLibrary and Google Books becomes one richer `Candidate` with
 * `notes._sources: ['web-search', 'google-books']`. Wikipedia enrichment
 * folds in the same way.
 *
 * After dedupe the shortlist is sorted by score and capped at five.
 *
 * Prior-memory fallback (three cases):
 *   1. Live candidates == 0 AND priorCandidates > 0:
 *      Use priorCandidates as the source pool. All carry
 *      `notes.fromPriorMemory: true`. Routes 'ranked'.
 *   2. Live candidates > 0 AND priorCandidates > 0:
 *      Merge both pools. After CanonicalId.dedupe, prefer live scout
 *      result over prior memory for duplicate ISBNs (higher score wins).
 *      Routes 'ranked'.
 *   3. Both empty → routes 'empty'.
 *
 * Demonstrates: a routing decision based on state contents, and a
 * named output union narrower than the default `'success'`.
 */

import { NodeOutputBuilder,
  EMPTY_CONTRACT_FRAGMENT,
  Timeout,
} from '@noocodex/dagonizer';
import type { NodeContextInterface, NodeInterface } from '@noocodex/dagonizer';

import type { Candidate } from '../entities/Book.ts';
import type { ArchivistState } from '../ArchivistState.ts';
import { UserLanguage } from '../language/UserLanguage.ts';
import type { ArchivistServices } from '../services.ts';
import { CanonicalId } from '@noocodex/dagonizer-book-entities';

const SHORTLIST_LIMIT = 5;

export class MergeCandidatesNode implements NodeInterface<ArchivistState, 'ranked' | 'empty', ArchivistServices> {
  readonly contract = EMPTY_CONTRACT_FRAGMENT;
  readonly timeout = Timeout.none();
  readonly name = 'merge-candidates';
  readonly outputs = ['ranked', 'empty'] as const;

  async execute(state: ArchivistState, context: NodeContextInterface<ArchivistServices>) {
    const targetIso2 = UserLanguage.toIso6392(state.userLanguage);

    // ── Both pools empty → soft gate ──────────────────────────────────────
    if (state.candidates.length === 0 && state.priorCandidates.length === 0) {
      state.shortlist = [];
      if (state.failureCause.trim().length === 0) {
        state.failureCause = 'No candidates found after searching all available sources. ';
      }
      context.services.logger.info('merge: live scouts returned 0, no prior memory candidates; routing empty');
      return NodeOutputBuilder.of('empty');
    }

    // ── Build the combined pool ────────────────────────────────────────────
    let pool: readonly Candidate[];

    if (state.candidates.length === 0) {
      // Case 1: live empty, fall back to prior memory exclusively.
      pool = state.priorCandidates;
      context.services.logger.info(
        `merge: live scouts returned 0, falling back to ${String(state.priorCandidates.length)} prior memory candidates`,
      );
    } else if (state.priorCandidates.length === 0) {
      // Case 2a: live only (original path).
      pool = state.candidates;
    } else {
      // Case 2b: both pools have content; merge, dedupe, prefer live over prior.
      // Build a set of ISBNs already present in live candidates.
      const liveIsbns = new Set(state.candidates.map((c) => c.book.identity.isbn));
      // Only add prior candidates whose ISBN is NOT already in live results.
      const priorOnly = state.priorCandidates.filter((c) => !liveIsbns.has(c.book.identity.isbn));
      pool = [...state.candidates, ...priorOnly];
      context.services.logger.info(
        `merge: ${String(state.candidates.length)} live + ${String(priorOnly.length)} prior (${String(pool.length)} combined before dedupe)`,
      );
    }

    // #region merge-aggregation
    // Cross-source dedupe: collapses hits sharing the same canonical id,
    // accumulating notes._sources[] and keeping the richest fields.
    const deduped = CanonicalId.dedupe(pool);
    // Defensive language filter: scouts already filter, but a candidate
    // can land here from a stale checkpoint or a future source that
    // skipped the per-scout filter. Candidates without language metadata
    // pass through unchanged.
    const inLanguage = deduped.filter((c) => {
      const langs = c.book.publication.languages;
      if (langs.length === 0) return true;
      return langs.includes(targetIso2);
    });
    const ranked = [...inLanguage]
      .sort((a, b) => b.score - a.score)
      .slice(0, SHORTLIST_LIMIT);

    state.shortlist = ranked;
    context.services.logger.info(`shortlist=${String(ranked.length)} (from ${String(pool.length)} pool, ${String(deduped.length)} after dedupe, ${String(inLanguage.length)} in ${state.userLanguage})`);
    if (ranked.length === 0 && state.failureCause.trim().length === 0) {
      state.failureCause = 'No candidates found after searching all available sources. ';
    }
    return NodeOutputBuilder.of(ranked.length > 0 ? 'ranked' : 'empty');
    // #endregion merge-aggregation
  }
}

/** Backward-compatible const export for existing bundle/DAG references. */
export const mergeCandidates = new MergeCandidatesNode();
