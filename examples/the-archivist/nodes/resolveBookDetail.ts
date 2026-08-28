/**
 * resolveBookDetail: resolves the `book-detail` follow-up ("tell me
 * about the invisible man") to a specific book already surfaced in this
 * conversation, WITHOUT running a fresh catalog search.
 *
 * The classifier routes `book-detail` here only when the visitor's phrase
 * plausibly refers to a book seen earlier (`classifyIntent` is instructed
 * to prefer `book-detail` over `search`/`describe-book` in that case).
 * This node re-confirms the reference deterministically against the
 * candidate pool accumulated so far this session:
 *
 *   `state.priorCandidates`                 — recalled from memory (recallContext)
 *   `state.shortlist`                       — the current run's shortlist, if any
 *   `state.recalledContext.recentCandidates` — recently shortlisted books (recallContext)
 *
 * Matching: normalized substring containment (the candidate's title
 * appears verbatim inside the visitor's phrase) scores 1.0; otherwise
 * `TextSimilarity.jaccard` on lowercase word tokens. The best-scoring
 * candidate above `MATCH_THRESHOLD` wins.
 *
 *   'resolved'   — a prior candidate matched; `state.shortlist` is
 *                  narrowed to that single book so `composeResponse`
 *                  produces a grounded single-book detail response.
 *   'unresolved' — no match cleared the threshold; the DAG falls back to
 *                  the ordinary on-topic search branch so the visitor
 *                  never gets stonewalled by a resolution miss.
 */

import { Batch, MonadicNode, NodeOutput, ReasoningStep, RoutedBatch } from '@studnicky/dagonizer';
import type { ItemType, NodeContextType, SchemaObjectType } from '@studnicky/dagonizer';

import type { ArchivistState } from '../ArchivistState.ts';
import type { CandidateType } from '../entities/Book.ts';
import { TextSimilarity } from './textUtils.ts';

/** Minimum match score (containment=1.0, else Jaccard) to accept a resolution. */
const MATCH_THRESHOLD = 0.34;

/**
 * BookDetailResolver: static matching helpers for the `book-detail` branch.
 */
export class BookDetailResolver {
  /** Lowercase, alphanumeric-only normalisation for substring containment checks. */
  static normalize(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]+/gu, ' ').trim();
  }

  /**
   * De-duplicated (by ISBN) candidate pool drawn from every source of
   * "books already seen this conversation": the current shortlist, the
   * memory-recalled prior candidates, and the recalled recent-candidates
   * roll-up. Most-recently-touched sources first so ties favour recency.
   */
  static candidatePool(state: ArchivistState): readonly CandidateType[] {
    const seenIsbns = new Set<string>();
    const pool: CandidateType[] = [];
    for (const candidate of [...state.shortlist, ...state.priorCandidates, ...state.recalledContext.recentCandidates]) {
      const isbn = candidate.book.identity.isbn;
      if (seenIsbns.has(isbn)) continue;
      seenIsbns.add(isbn);
      pool.push(candidate);
    }
    return pool;
  }

  /**
   * Best-scoring candidate whose title plausibly matches `query`, or
   * `null` when nothing clears `MATCH_THRESHOLD`.
   */
  static resolve(query: string, pool: readonly CandidateType[]): CandidateType | null {
    const queryTokens = TextSimilarity.tokenise(query);
    const queryNormalized = BookDetailResolver.normalize(query);

    let best: CandidateType | null = null;
    let bestScore = 0;
    for (const candidate of pool) {
      const title = candidate.book.identity.title;
      const titleNormalized = BookDetailResolver.normalize(title);
      const contained = titleNormalized.length > 0 && queryNormalized.includes(titleNormalized);
      const score = contained ? 1 : TextSimilarity.jaccard(queryTokens, TextSimilarity.tokenise(title));
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return bestScore >= MATCH_THRESHOLD ? best : null;
  }
}

export class ResolveBookDetailNode extends MonadicNode<ArchivistState, 'resolved' | 'unresolved'> {
  readonly name = 'resolve-book-detail';
  readonly '@id' = 'urn:noocodec:node:resolve-book-detail';
  readonly outputs = ['resolved', 'unresolved'] as const;
  override get outputSchema(): Record<'resolved' | 'unresolved', SchemaObjectType> {
    return {
      'resolved':   { 'type': 'object' },
      'unresolved': { 'type': 'object' },
    };
  }

  override async execute(batch: Batch<ArchivistState>, _context: NodeContextType) {
    const resolvedItems: ItemType<ArchivistState>[] = [];
    const unresolvedItems: ItemType<ArchivistState>[] = [];

    for (const item of batch) {
      const { state } = item;
      const pool = BookDetailResolver.candidatePool(state);
      const match = BookDetailResolver.resolve(state.query, pool);

      if (match !== null) {
        state.shortlist = [match];
        state.reasoning = [...state.reasoning, ReasoningStep.create({
          'kind': 'thought',
          'text': `resolved book-detail follow-up to prior candidate "${match.book.identity.title}"`,
        })];
        const result = NodeOutput.create('resolved');
        for (const error of result.errors) state.collectError(error);
        resolvedItems.push(item);
      } else {
        state.reasoning = [...state.reasoning, ReasoningStep.create({
          'kind': 'thought',
          'text': 'book-detail follow-up matched no prior candidate; falling back to search',
        })];
        const result = NodeOutput.create('unresolved');
        for (const error of result.errors) state.collectError(error);
        unresolvedItems.push(item);
      }
    }

    const routes: Array<readonly ['resolved' | 'unresolved', Batch<ArchivistState>]> = [];
    if (resolvedItems.length > 0) routes.push(['resolved', Batch.from(resolvedItems)]);
    if (unresolvedItems.length > 0) routes.push(['unresolved', Batch.from(unresolvedItems)]);
    return RoutedBatch.create(routes);
  }
}
