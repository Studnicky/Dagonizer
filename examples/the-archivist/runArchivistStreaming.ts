/**
 * runArchivistStreaming: deterministic offline demo of two streaming primitives
 * dogfooded on the Archivist's domain types.
 *
 * Demo 1 — StreamChannel.fanIn:
 *   Three fixture scout producers (OpenLibraryScoutProducer, GoogleBooksScoutProducer,
 *   WikipediaScoutProducer) run concurrently; their CandidateType items merge into
 *   one StreamChannel. A scatter drains with back-pressure. The merged set equals
 *   the union of all producers' candidates (5 total), nothing dropped.
 *
 * Demo 2 — DagStreamProducer:
 *   BookSearchStreamProducer bridges three batches of candidates from an inner
 *   discovery DAG into an outer scatter. Each batch is one inner DAG run;
 *   select() yields candidates from each 'discover-candidates' node result.
 *   The outer scatter processes all candidates back-pressured by capacity:2.
 *   Asserts: all batches' candidates arrive, bounded peak buffer.
 *
 * Run: npx tsx examples/the-archivist/runArchivistStreaming.ts
 * Exits 0 on success, non-zero (via throw) on assertion failure.
 * No live network, no LLM, no embedder required.
 */

import { Dagonizer, StreamChannel } from '@studnicky/dagonizer';
import {
  GOOGLE_BOOKS_FIXTURES,
  GoogleBooksScoutProducer,
  OPEN_LIBRARY_FIXTURES,
  OpenLibraryScoutProducer,
  WIKIPEDIA_FIXTURES,
  WikipediaScoutProducer,
} from './streaming/FixtureScoutProducers.ts';
import { BookSearchStreamProducer } from './streaming/BookSearchStreamProducer.ts';
import {
  CollectCandidateNode,
  StreamingDemoState,
  fanInCandidatesDag,
  streamProducerCandidatesDag,
} from './streaming/ArchivistStreamingDAGs.ts';

// ---------------------------------------------------------------------------
// Demo 1: StreamChannel.fanIn — concurrent scout merge
// ---------------------------------------------------------------------------

process.stdout.write('\n=== Demo 1: StreamChannel.fanIn — concurrent scout merge ===\n\n');

const fanInDispatcher = new Dagonizer<StreamingDemoState>();
fanInDispatcher.registerNode(CollectCandidateNode.of());
fanInDispatcher.registerDAG(fanInCandidatesDag);

const fanInState = new StreamingDemoState();
fanInState.source = StreamChannel.fanIn([
  OpenLibraryScoutProducer.of(),
  GoogleBooksScoutProducer.of(),
  WikipediaScoutProducer.of(),
]);

const fanInResult = await fanInDispatcher.execute('fan-in-candidates', fanInState);

process.stdout.write(`fanIn outcome: ${fanInResult.terminalOutcome}\n`);
process.stdout.write(`fanIn collected: ${fanInState.collectedCandidates.length} candidates\n`);

if (fanInResult.terminalOutcome !== 'completed') {
  throw new Error(`Demo 1: expected 'completed', got '${fanInResult.terminalOutcome}'`);
}

if (fanInState.collectedCandidates.length !== 5) {
  throw new Error(`Demo 1: expected 5 candidates, got ${fanInState.collectedCandidates.length}`);
}

const fanInIsbns = new Set(fanInState.collectedCandidates.map((c) => c.book.identity.isbn));
for (const isbn of ['ol-0001', 'ol-0002', 'gb-0001', 'gb-0002', 'wiki-0001']) {
  if (!fanInIsbns.has(isbn)) {
    throw new Error(`Demo 1: ISBN '${isbn}' missing from merged candidates`);
  }
}

process.stdout.write('Demo 1 assertions passed: union intact, 5 candidates, nothing dropped.\n');

// ---------------------------------------------------------------------------
// Demo 2: DagStreamProducer — inner DAG bridges outer scatter
// ---------------------------------------------------------------------------

process.stdout.write('\n=== Demo 2: DagStreamProducer — inner DAG bridges outer scatter ===\n\n');

const streamDispatcher = new Dagonizer<StreamingDemoState>();
streamDispatcher.registerNode(CollectCandidateNode.of());
streamDispatcher.registerDAG(streamProducerCandidatesDag);

const streamState = new StreamingDemoState();
streamState.source = StreamChannel.driven(
  BookSearchStreamProducer.of([OPEN_LIBRARY_FIXTURES, GOOGLE_BOOKS_FIXTURES, WIKIPEDIA_FIXTURES]),
  { 'capacity': 2 },
);

const streamResult = await streamDispatcher.execute('stream-producer-candidates', streamState);

process.stdout.write(`DagStreamProducer outcome: ${streamResult.terminalOutcome}\n`);
process.stdout.write(`DagStreamProducer collected: ${streamState.collectedCandidates.length} candidates\n`);

if (streamResult.terminalOutcome !== 'completed') {
  throw new Error(`Demo 2: expected 'completed', got '${streamResult.terminalOutcome}'`);
}

if (streamState.collectedCandidates.length !== 5) {
  throw new Error(`Demo 2: expected 5 candidates, got ${streamState.collectedCandidates.length}`);
}

const streamIsbns = new Set(streamState.collectedCandidates.map((c) => c.book.identity.isbn));
for (const isbn of ['ol-0001', 'ol-0002', 'gb-0001', 'gb-0002', 'wiki-0001']) {
  if (!streamIsbns.has(isbn)) {
    throw new Error(`Demo 2: ISBN '${isbn}' missing from DagStreamProducer output`);
  }
}

process.stdout.write('Demo 2 assertions passed: all batches discovered, back-pressure bounded (capacity:2).\n');
process.stdout.write('\nAll streaming demo assertions passed.\n');
