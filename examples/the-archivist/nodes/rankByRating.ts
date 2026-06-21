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
import type { NodeContextType, SchemaObjectType } from '@studnicky/dagonizer';

import type { CandidateType } from '../entities/Book.ts';
import type { ArchivistState } from '../ArchivistState.ts';
import type { ArchivistServices } from '../services.ts';

export class RankByRatingNode extends ScalarNode<ArchivistState, 'ranked', ArchivistServices> {
  readonly name = 'rank-by-rating';
  readonly outputs = ['ranked'] as const;
  override get outputSchema(): Record<'ranked', SchemaObjectType> {
    return {
      'ranked': { 'type': 'object' },
    };
  }

  protected override executeOne(state: ArchivistState, _context: NodeContextType<ArchivistServices>) {
    if (state.candidates.length === 0) {
      return Promise.resolve(NodeOutputBuilder.of('ranked'));
    }

    const weighted = state.candidates.map((c) => {
      const rating       = typeof c.notes?.['rating']       === 'number' ? c.notes['rating']       : 0;
      const ratingsCount = typeof c.notes?.['ratingsCount'] === 'number' ? c.notes['ratingsCount'] : 0;
      const weight = rating * Math.log10(1 + ratingsCount);
      return { "candidate": c, weight };
    });

    const maxWeight = Math.max(...weighted.map((w) => w.weight), 0);

    const ranked: CandidateType[] = weighted
      .sort((a, b) => b.weight - a.weight)
      .map(({ candidate, weight }) => ({
        ...candidate,
        'score': maxWeight > 0 ? weight / maxWeight : 0,
      }));

    state.candidates = ranked;

    return Promise.resolve(NodeOutputBuilder.of('ranked'));
  }
}

/** Singleton node instance referenced by the DAG wiring. */
export const rankByRating = new RankByRatingNode();
