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

import { MonadicNode, RoutedBatch } from '@studnicky/dagonizer';
import type { Batch, NodeContextType, SchemaObjectType } from '@studnicky/dagonizer';

import type { CandidateType } from '../entities/Book.ts';
import type { ArchivistState } from '../ArchivistState.ts';

export class GroupByYearNode extends MonadicNode<ArchivistState, 'ordered'> {
  readonly name = 'group-by-year';
  readonly '@id' = 'urn:noocodec:node:group-by-year';
  readonly outputs = ['ordered'] as const;
  override get outputSchema(): Record<'ordered', SchemaObjectType> {
    return {
      'ordered': { 'type': 'object' },
    };
  }

  override async execute(batch: Batch<ArchivistState>, _context: NodeContextType) {
    for (const { state } of batch) {
      if (state.candidates.length === 0) continue;
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
    }
    return RoutedBatch.create('ordered', batch);
  }
}

/** Singleton node instance referenced by the DAG wiring. */
export const groupByYear = new GroupByYearNode();
