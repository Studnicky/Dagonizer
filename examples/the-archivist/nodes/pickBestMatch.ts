/**
 * pickBestMatch — deterministic title-similarity ranker for the
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

import type { Candidate } from '../entities/Book.ts';

import type { ArchivistNode } from './ArchivistNode.ts';

const TOP_K = 3;

function wordSet(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/gu, ' ').split(/\s+/u).filter((w) => w.length > 1),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export const pickBestMatch: ArchivistNode<'picked'> = {
  'name':    'pick-best-match',
  'kind':    'deterministic',
  'outputs': ['picked'],
  execute(state, context) {
    if (state.candidates.length === 0) {
      context.services.logger.info('pick-best-match: no candidates');
      return Promise.resolve({ 'output': 'picked' });
    }

    const queryWords = wordSet(state.query);

    const scored = state.candidates.map((c) => {
      const text   = `${c.book.title} ${c.book.authors.join(' ')}`;
      const sim    = jaccard(queryWords, wordSet(text));
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
        ? ` (best sim ${top.sim.toFixed(3)}: "${top.candidate.book.title}")`
        : ''),
    );

    return Promise.resolve({ 'output': 'picked' });
  },
};
