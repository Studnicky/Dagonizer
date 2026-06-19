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

import { NodeOutputBuilder, ScalarNode } from '@studnicky/dagonizer';
import type { NodeContextType } from '@studnicky/dagonizer';

import type { CandidateType } from '../entities/Book.ts';
import type { ArchivistState } from '../ArchivistState.ts';
import type { ArchivistServices } from '../services.ts';

export class GroupByYearNode extends ScalarNode<ArchivistState, 'ordered', ArchivistServices> {
  readonly name = 'group-by-year';
  readonly outputs = ['ordered'] as const;

  protected override async executeOne(state: ArchivistState, context: NodeContextType<ArchivistServices>) {
    if (state.candidates.length === 0) {
      context.services.logger.info('group-by-year: nothing to reorder');
      return NodeOutputBuilder.of('ordered');
    }
    const indexed = state.candidates.map((candidate, position) => ({ candidate, position }));
    indexed.sort((a, b) => {
      const ya = a.candidate.book.publication.firstPublishYear;
      const yb = b.candidate.book.publication.firstPublishYear;
      // Unknown publication year (null) sorts last; ties keep original position.
      if (ya === null && yb === null) return a.position - b.position;
      if (ya === null) return 1;
      if (yb === null) return -1;
      if (ya !== yb) return ya - yb;
      return a.position - b.position;
    });
    const ordered: CandidateType[] = indexed.map((entry) => entry.candidate);
    state.candidates = ordered;
    state.shortlist  = ordered;
    const first = ordered[0];
    const last  = ordered[ordered.length - 1];
    if (first !== undefined && last !== undefined) {
      const firstYear = first.book.publication.firstPublishYear !== null ? String(first.book.publication.firstPublishYear) : '?';
      const lastYear  = last.book.publication.firstPublishYear  !== null ? String(last.book.publication.firstPublishYear)  : '?';
      context.services.logger.info(`group-by-year: ${String(ordered.length)} works (${firstYear} → ${lastYear})`);
    }
    return NodeOutputBuilder.of('ordered');
  }
}

/** Singleton node instance referenced by the DAG wiring. */
export const groupByYear = new GroupByYearNode();
