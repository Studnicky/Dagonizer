/**
 * rankByRating: deterministic rating-weighted ranker for the
 * `find-reviews` branch.
 *
 * Ranks the reviews branch objectively and reproducibly, without an
 * LLM: a candidate with 4.5 stars across 10,000 ratings outranks one
 * with 5 stars across 3 ratings.
 *
 * Weight formula:
 *   weight = (notes.rating ?? 0) * log10(1 + (notes.ratingsCount ?? 0))
 *
 * Candidates with no rating data fall to the bottom (weight 0). The
 * top-weighted candidate is normalised to score = 1.0; all others are
 * scaled proportionally.
 *
 * Output route is always 'ranked'; empty or unrated sets pass through
 * so the merge node can soft-gate downstream.
 */

import { NodeOutputBuilder, ScalarNode } from '@studnicky/dagonizer';
import type { NodeContextInterface } from '@studnicky/dagonizer';

import type { Candidate } from '../entities/Book.ts';
import type { ArchivistState } from '../ArchivistState.ts';
import type { ArchivistServices } from '../services.ts';

export class RankByRatingNode extends ScalarNode<ArchivistState, 'ranked', ArchivistServices> {
  readonly name = 'rank-by-rating';
  readonly outputs = ['ranked'] as const;

  protected override executeOne(state: ArchivistState, context: NodeContextInterface<ArchivistServices>) {
    if (state.candidates.length === 0) {
      context.services.logger.info('rank-by-rating: no candidates');
      return Promise.resolve(NodeOutputBuilder.of('ranked'));
    }

    const weighted = state.candidates.map((c) => {
      const rating       = typeof c.notes?.['rating']       === 'number' ? c.notes['rating']       : 0;
      const ratingsCount = typeof c.notes?.['ratingsCount'] === 'number' ? c.notes['ratingsCount'] : 0;
      const weight = rating * Math.log10(1 + ratingsCount);
      return { "candidate": c, weight };
    });

    const maxWeight = Math.max(...weighted.map((w) => w.weight), 0);

    const ranked: Candidate[] = weighted
      .sort((a, b) => b.weight - a.weight)
      .map(({ candidate, weight }) => ({
        ...candidate,
        'score': maxWeight > 0 ? weight / maxWeight : 0,
      }));

    state.candidates = ranked;

    const top = ranked[0];
    context.services.logger.info(
      `rank-by-rating: ${String(ranked.length)} ranked` +
      (top !== undefined
        ? ` (top score ${top.score.toFixed(3)}: "${top.book.identity.title}")`
        : ''),
    );

    return Promise.resolve(NodeOutputBuilder.of('ranked'));
  }
}

/** Singleton node instance referenced by the DAG wiring. */
export const rankByRating = new RankByRatingNode();
