/**
 * mergeCandidates — cross-source dedupe, rank by score, keep top five.
 *
 * Uses `CanonicalId.dedupe` to collapse multi-source hits sharing the
 * same canonical id (ISBN-13 → ISBN-10 → work URN). A book seen by
 * both OpenLibrary and Google Books becomes one richer `Candidate` with
 * `notes._sources: ['web-search', 'google-books']`. Wikipedia enrichment
 * folds in the same way.
 *
 * After dedupe the shortlist is sorted by score and capped at five.
 * Hard soft gate: if the shortlist is empty after merge, route to
 * `empty` so the dispatcher can fall through to the fallback embedded-DAG.
 *
 * Demonstrates: a routing decision based on state contents, and a
 * named output union narrower than the default `'success'`.
 */

import type { ArchivistState } from '../ArchivistState.ts';
import { UserLanguage } from '../language/UserLanguage.ts';
import type { ArchivistServices } from '../services.ts';
import { CanonicalId } from '@noocodex/dagonizer-tool-openlibrary';

import type { NodeInterface } from '@noocodex/dagonizer';

const SHORTLIST_LIMIT = 5;

export const mergeCandidates: NodeInterface<ArchivistState, 'ranked' | 'empty', ArchivistServices> = {
  "name": 'merge-candidates',
  "outputs": ['ranked', 'empty'],
  async execute(state, context) {
    // #region fanin-aggregation
    // Cross-source dedupe: collapses hits sharing the same canonical id,
    // accumulating notes._sources[] and keeping the richest fields.
    const deduped = CanonicalId.dedupe(state.candidates);
    // Defensive language filter — scouts already filter, but a candidate
    // can land here from a stale checkpoint or a future source that
    // skipped the per-scout filter. Candidates without language metadata
    // pass through unchanged.
    const targetIso2 = UserLanguage.toIso6392(state.userLanguage);
    const inLanguage = deduped.filter((c) => {
      const langs = c.book.languages;
      if (langs === undefined || langs.length === 0) return true;
      return langs.includes(targetIso2);
    });
    const ranked = [...inLanguage]
      .sort((a, b) => b.score - a.score)
      .slice(0, SHORTLIST_LIMIT);

    state.shortlist = ranked;
    context.services.logger.info(`shortlist=${String(ranked.length)} (from ${String(state.candidates.length)} candidates, ${String(deduped.length)} after dedupe, ${String(inLanguage.length)} in ${state.userLanguage})`);
    if (ranked.length === 0 && state.failureCause.trim().length === 0) {
      state.failureCause = 'No candidates found after searching all available sources. ';
    }
    return { "output": ranked.length > 0 ? 'ranked' : 'empty' };
    // #endregion fanin-aggregation
  },
};
