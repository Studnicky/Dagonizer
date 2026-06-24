/**
 * FixtureScoutProducers: deterministic, offline StreamProducerInterface implementations
 * that push hardcoded CandidateType fixtures into a sink. No network, no LLM, no embedder.
 *
 * Used by runArchivistStreaming.ts for Demo 1 (StreamChannel.fanIn) and to supply
 * fixture batch arrays for Demo 2 (DagStreamProducer / BookSearchStreamProducer).
 */

import type { StreamSinkInterface } from '@studnicky/dagonizer/contracts';
import { BookBuilder } from '../entities/Book.ts';
import type { CandidateType } from '../entities/Book.ts';

// ---------------------------------------------------------------------------
// Module-level fixture data (exported for Demo 2 batch construction)
// ---------------------------------------------------------------------------

export const OPEN_LIBRARY_FIXTURES: CandidateType[] = [
  {
    book:   BookBuilder.from({ isbn: 'ol-0001', title: 'The Labyrinth of Light',  authors: ['Ada Fixture'], price: { amount: 0, currency: 'USD' } }),
    score:  0.5,
    source: 'web_search_books',
  },
  {
    book:   BookBuilder.from({ isbn: 'ol-0002', title: 'Echoes in the Archive',   authors: ['Ben Fixture'], price: { amount: 0, currency: 'USD' } }),
    score:  0.5,
    source: 'web_search_books',
  },
];

export const GOOGLE_BOOKS_FIXTURES: CandidateType[] = [
  {
    book:   BookBuilder.from({ isbn: 'gb-0001', title: 'Memory Palace',           authors: ['Cara Fixture'], price: { amount: 0, currency: 'USD' } }),
    score:  0.5,
    source: 'google_books_search',
  },
  {
    book:   BookBuilder.from({ isbn: 'gb-0002', title: 'Shadows of the Stacks',   authors: ['Dan Fixture'], price: { amount: 0, currency: 'USD' } }),
    score:  0.5,
    source: 'google_books_search',
  },
];

export const WIKIPEDIA_FIXTURES: CandidateType[] = [
  {
    book:   BookBuilder.from({ isbn: 'wiki-0001', title: 'The Library of Forgotten Things', authors: ['Eve Fixture'], price: { amount: 0, currency: 'USD' } }),
    score:  0.5,
    source: 'wikipedia_summary',
  },
];

// ---------------------------------------------------------------------------
// OpenLibraryScoutProducer
// ---------------------------------------------------------------------------

export class OpenLibraryScoutProducer {
  static of(): OpenLibraryScoutProducer {
    return new OpenLibraryScoutProducer();
  }

  async produce(sink: StreamSinkInterface<CandidateType>): Promise<void> {
    for (const candidate of OPEN_LIBRARY_FIXTURES) {
      await sink.push(candidate);
    }
  }
}

// ---------------------------------------------------------------------------
// GoogleBooksScoutProducer
// ---------------------------------------------------------------------------

export class GoogleBooksScoutProducer {
  static of(): GoogleBooksScoutProducer {
    return new GoogleBooksScoutProducer();
  }

  async produce(sink: StreamSinkInterface<CandidateType>): Promise<void> {
    for (const candidate of GOOGLE_BOOKS_FIXTURES) {
      await sink.push(candidate);
    }
  }
}

// ---------------------------------------------------------------------------
// WikipediaScoutProducer
// ---------------------------------------------------------------------------

export class WikipediaScoutProducer {
  static of(): WikipediaScoutProducer {
    return new WikipediaScoutProducer();
  }

  async produce(sink: StreamSinkInterface<CandidateType>): Promise<void> {
    for (const candidate of WIKIPEDIA_FIXTURES) {
      await sink.push(candidate);
    }
  }
}
