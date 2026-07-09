/**
 * mergeCandidates: cross-source dedupe, rank by score, keep top five.
 *
 * Uses `CanonicalId.dedupe` to collapse multi-source hits sharing the
 * same canonical id (ISBN-13 → ISBN-10 → work URN). A book seen by
 * both OpenLibrary and Google Books becomes one richer `Candidate` with
 * `notes.sources: ['web-search', 'google-books']`. Wikipedia enrichment
 * folds in the same way.
 *
 * After dedupe the shortlist is sorted by score and capped at five.
 *
 * Prior memory participates in the same pool as live candidates.
 * When both exist, the merge keeps the higher-scoring candidate for each
 * canonical id. If both pools are empty, the node routes 'empty'.
 *
 * Demonstrates: a routing decision based on state contents, and a
 * named output union narrower than the default `'success'`.
 */

import { Batch, MonadicNode, NodeOutput, RoutedBatch } from '@studnicky/dagonizer';
import type { ItemType, NodeContextType, SchemaObjectType } from '@studnicky/dagonizer';

import type { CandidateType } from '../entities/Book.ts';
import type { ArchivistState } from '../ArchivistState.ts';
import { UserLanguage } from '../language/UserLanguage.ts';
import { CanonicalId } from '@studnicky/dagonizer-book-entities';

const SHORTLIST_LIMIT = 8;

export class MergeCandidatesNode extends MonadicNode<ArchivistState, 'ranked' | 'empty'> {
  readonly name = 'merge-candidates';
  readonly '@id' = 'urn:noocodec:node:merge-candidates';
  readonly outputs = ['ranked', 'empty'] as const;
  override get outputSchema(): Record<'ranked' | 'empty', SchemaObjectType> {
    return {
      'ranked': { 'type': 'object' },
      'empty':  { 'type': 'object' },
    };
  }

  override async execute(batch: Batch<ArchivistState>, _context: NodeContextType) {
    const rankedItems: ItemType<ArchivistState>[] = [];
    const emptyItems: ItemType<ArchivistState>[] = [];

    for (const item of batch) {
      const { state } = item;
    const targetIso2 = UserLanguage.toIso6392(state.userLanguage);

    // ── Both pools empty → soft gate ──────────────────────────────────────
    if (state.candidates.length === 0 && state.priorCandidates.length === 0) {
      state.shortlist = [];
      if (state.failureCause.trim().length === 0) {
        state.failureCause = 'No candidates found after searching all available sources. ';
      }
      const result = NodeOutput.create('empty');
      for (const error of result.errors) state.collectError(error);
      emptyItems.push(item);
      continue;
    }

    // ── Build the combined pool ────────────────────────────────────────────
    let pool: readonly CandidateType[];

    if (state.candidates.length === 0) {
      // Prior memory only.
      pool = state.priorCandidates;
    } else if (state.priorCandidates.length === 0) {
      // Live candidates only.
      pool = state.candidates;
    } else {
      // Merge both pools and keep one entry per ISBN.
      const liveIsbns = new Set(state.candidates.map((c) => c.book.identity.isbn));
      const priorOnly = state.priorCandidates.filter((c) => !liveIsbns.has(c.book.identity.isbn));
      pool = [...state.candidates, ...priorOnly];
    }

    // #region merge-aggregation
    // Cross-source dedupe: collapses hits sharing the same canonical id,
    // accumulating notes.sources[] and keeping the richest fields.
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
    if (ranked.length === 0 && state.failureCause.trim().length === 0) {
      state.failureCause = 'No candidates found after searching all available sources. ';
    }
      const result = NodeOutput.create(ranked.length > 0 ? 'ranked' : 'empty');
      for (const error of result.errors) state.collectError(error);
      if (result.output === 'ranked') {
        rankedItems.push(item);
      } else {
        emptyItems.push(item);
      }
    // #endregion merge-aggregation
    }

    const routes: Array<readonly ['ranked' | 'empty', Batch<ArchivistState>]> = [];
    if (rankedItems.length > 0) routes.push(['ranked', Batch.from(rankedItems)]);
    if (emptyItems.length > 0) routes.push(['empty', Batch.from(emptyItems)]);
    return RoutedBatch.create(routes);
  }
}

/** Singleton node instance referenced by the DAG wiring. */
export const mergeCandidates = new MergeCandidatesNode();
