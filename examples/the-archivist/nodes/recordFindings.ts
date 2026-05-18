/**
 * recordFindings — memory node.
 *
 *   Mints one URI per candidate (`urn:dagonizer:book:<isbn>`) and writes
 *   four triples per book:
 *
 *     <book> dag:title      "<title>"
 *     <book> dag:source     "<scout name>"
 *     <book> dag:score      "<score>"^^xsd:double
 *     <book> dag:inShortlist "<bool>"^^xsd:boolean
 *
 *   This is the canonical "deterministic memory write" node — same
 *   input candidates always produce the same triples, so a downstream
 *   SPARQL ASK gate can rely on the store as ground truth.
 */

import { MemoryStore } from '../memory/MemoryStore.ts';

import type { ArchivistNode } from './ArchivistNode.ts';

const dagTitle             = MemoryStore.dagIri('title');
const dagSource            = MemoryStore.dagIri('source');
const dagScore             = MemoryStore.dagIri('score');
const dagInShortlist       = MemoryStore.dagIri('inShortlist');
const dagVisitorQuery      = MemoryStore.dagIri('visitorQuery');
const dagRunTimestamp      = MemoryStore.dagIri('runTimestamp');
const dagShortlistedTitle  = MemoryStore.dagIri('shortlistedTitle');

export const recordFindings: ArchivistNode<'recorded'> = {
  "name": 'record-findings',
  "kind": 'deterministic',
  "outputs": ['recorded'],
  async execute(state, context) {
    const memory = context.services.memory;
    const shortlistIsbns = new Set(state.shortlist.map((c) => c.book.isbn));
    for (const candidate of state.candidates) {
      const book = MemoryStore.bookIri(candidate.book.isbn);
      memory.assert(book, dagTitle,       MemoryStore.lit.str(candidate.book.title));
      memory.assert(book, dagSource,      MemoryStore.lit.str(candidate.source));
      memory.assert(book, dagScore,       MemoryStore.lit.num(candidate.score));
      memory.assert(book, dagInShortlist, MemoryStore.lit.bool(shortlistIsbns.has(candidate.book.isbn)));
    }

    // Per-run facts so future runs can recall this visitor's session.
    if (state.runId !== '') {
      const run = MemoryStore.runIri(state.runId);
      memory.assert(run, dagVisitorQuery, MemoryStore.lit.str(state.query));
      memory.assert(run, dagRunTimestamp, MemoryStore.lit.num(Date.now()));
      for (const candidate of state.shortlist) {
        memory.assert(run, dagShortlistedTitle, MemoryStore.lit.str(candidate.book.title));
      }
    }

    return { "output": 'recorded' };
  },
};
