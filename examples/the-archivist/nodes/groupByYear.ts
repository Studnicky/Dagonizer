/**
 * groupByYear: deterministic re-ordering for the `lookup-author` branch.
 *
 * Sorts `state.candidates` ascending by `book.firstPublishYear` so the
 * author's body of work reads chronologically (earliest first). Missing
 * years sink to the end; relative order within an undated bucket is
 * preserved (stable sort).
 *
 * The compose prompt for this branch (`prompts.composeAuthor`) is
 * primed with the `chronological` directive, so the LLM is told to
 * present the works in publication order; this node makes that
 * promise true at the data level.
 */

import type { Candidate } from '../entities/Book.ts';

import type { ArchivistNode } from './ArchivistNode.ts';

export const groupByYear: ArchivistNode<'ordered'> = {
  'name':    'group-by-year',
  'kind':    'deterministic',
  'outputs': ['ordered'],
  async execute(state, context) {
    if (state.candidates.length === 0) {
      context.services.logger.info('group-by-year: nothing to reorder');
      return { 'output': 'ordered' };
    }
    const indexed = state.candidates.map((candidate, position) => ({ candidate, position }));
    indexed.sort((a, b) => {
      const ya = a.candidate.book.firstPublishYear;
      const yb = b.candidate.book.firstPublishYear;
      if (ya === undefined && yb === undefined) return a.position - b.position;
      if (ya === undefined) return 1;
      if (yb === undefined) return -1;
      if (ya !== yb) return ya - yb;
      return a.position - b.position;
    });
    const ordered: Candidate[] = indexed.map((entry) => entry.candidate);
    state.candidates = ordered;
    state.shortlist  = ordered;
    const first = ordered[0];
    const last  = ordered[ordered.length - 1];
    if (first !== undefined && last !== undefined) {
      const firstYear = first.book.firstPublishYear !== undefined ? String(first.book.firstPublishYear) : '?';
      const lastYear  = last.book.firstPublishYear  !== undefined ? String(last.book.firstPublishYear)  : '?';
      context.services.logger.info(`group-by-year: ${String(ordered.length)} works (${firstYear} → ${lastYear})`);
    }
    return { 'output': 'ordered' };
  },
};
