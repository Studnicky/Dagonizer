/**
 * pickBestMatch: deterministic title-similarity ranker for the
 * `describe-book` branch.
 *
 * When web-search returns multiple hits for a single-title lookup the
 * first 5 are picked arbitrarily by mergeCandidates. This node runs
 * before merge and narrows the field to the top 3 most-similar matches
 * so the LLM composer works with the right book.
 *
 * Similarity metric: lowercase Jaccard on word sets built from the
 * visitor's query against each candidate's `title + authors`.
 *
 *   jaccard(A, B) = |A ∩ B| / |A ∪ B|
 *
 * Candidates with score 0 (no word overlap) are retained in position
 * (after top-3) so a completely empty result does not block the branch.
 *
 * Output route is always 'picked'.
 */

import { NodeOutputBuilder, ScalarNode } from '@studnicky/dagonizer';
import type { NodeContextInterface } from '@studnicky/dagonizer';

import type { Candidate } from '../entities/Book.ts';
import type { ArchivistState } from '../ArchivistState.ts';
import type { ArchivistServices } from '../services.ts';
import { TextSimilarity } from './textUtils.ts';

const TOP_K = 3;

export class PickBestMatchNode extends ScalarNode<ArchivistState, 'picked', ArchivistServices> {
  readonly name = 'pick-best-match';
  readonly outputs = ['picked'] as const;

  protected override executeOne(state: ArchivistState, context: NodeContextInterface<ArchivistServices>) {
    if (state.candidates.length === 0) {
      context.services.logger.info('pick-best-match: no candidates');
      return Promise.resolve(NodeOutputBuilder.of('picked'));
    }

    const queryWords = TextSimilarity.tokenise(state.query);

    const scored = state.candidates.map((c) => {
      const text   = `${c.book.identity.title} ${c.book.identity.authors.join(' ')}`;
      const sim    = TextSimilarity.jaccard(queryWords, TextSimilarity.tokenise(text));
      return { "candidate": c, sim };
    });

    scored.sort((a, b) => b.sim - a.sim);

    const topK   = scored.slice(0, TOP_K);
    const rest   = scored.slice(TOP_K);

    const picked: Candidate[] = [
      ...topK.map(({ candidate, sim }) => ({ ...candidate, 'score': sim })),
      ...rest.map(({ candidate }) => ({ ...candidate })),
    ];

    state.candidates = picked;

    const top = topK[0];
    context.services.logger.info(
      `pick-best-match: kept top ${String(Math.min(TOP_K, scored.length))} of ${String(scored.length)}` +
      (top !== undefined
        ? ` (best sim ${top.sim.toFixed(3)}: "${top.candidate.book.identity.title}")`
        : ''),
    );

    return Promise.resolve(NodeOutputBuilder.of('picked'));
  }
}

/** Singleton node instance referenced by the DAG wiring. */
export const pickBestMatch = new PickBestMatchNode();
