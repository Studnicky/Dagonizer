/**
 * recordFindings — memory node.
 *
 *   Mints one URI per candidate (`urn:dagonizer:book:<isbn>`) and writes
 *   triples per book into `urn:dagonizer:memory` (the persistent cross-run
 *   named graph). Includes `rdf:type` triples to link ABox instances to
 *   their TBox classes in `urn:dagonizer:ontology`, which makes ontology
 *   class nodes visible as connected hubs in the MemoryGraph view:
 *
 *     <book> rdf:type       dag:Book
 *     <book> dag:title      "<title>"
 *     <book> dag:source     "<scout name>"
 *     <book> dag:score      "<score>"^^xsd:double
 *     <book> dag:inShortlist "<bool>"^^xsd:boolean
 *
 *     <run>  rdf:type          dag:Run
 *     <run>  dag:visitorQuery  "<query>"
 *     <run>  dag:runTimestamp  "<ms>"^^xsd:double
 *     <run>  dag:shortlisted   <book>           (object property — links run to book URIs)
 *
 *   This is the canonical "deterministic memory write" node — same
 *   input candidates always produce the same triples, so a downstream
 *   SPARQL ASK gate can rely on the store as ground truth.
 */

import { GRAPH_MEMORY, MemoryStore } from '../memory/MemoryStore.ts';

import type { ArchivistNode } from './ArchivistNode.ts';

const rdfType              = MemoryStore.iri('http://www.w3.org/1999/02/22-rdf-syntax-ns#type');
const dagBook              = MemoryStore.dagIri('Book');
const dagRun               = MemoryStore.dagIri('Run');
const dagTitle             = MemoryStore.dagIri('title');
const dagSource            = MemoryStore.dagIri('source');
const dagScore             = MemoryStore.dagIri('score');
const dagInShortlist       = MemoryStore.dagIri('inShortlist');
const dagShortlisted       = MemoryStore.dagIri('shortlisted');
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
      // rdf:type links this ABox instance to the TBox dag:Book class —
      // this is the triple that connects memory nodes to ontology class nodes
      // in the MemoryGraph cosmos.gl view.
      memory.assert(book, rdfType,        dagBook,                                               GRAPH_MEMORY);
      memory.assert(book, dagTitle,       MemoryStore.lit.str(candidate.book.title),             GRAPH_MEMORY);
      memory.assert(book, dagSource,      MemoryStore.lit.str(candidate.source),                 GRAPH_MEMORY);
      memory.assert(book, dagScore,       MemoryStore.lit.num(candidate.score),                  GRAPH_MEMORY);
      memory.assert(book, dagInShortlist, MemoryStore.lit.bool(shortlistIsbns.has(candidate.book.isbn)), GRAPH_MEMORY);
    }

    // Per-run facts so future runs can recall this visitor's session.
    if (state.runId !== '') {
      const run = MemoryStore.runIri(state.runId);
      // rdf:type links this ABox run instance to the TBox dag:Run class.
      memory.assert(run, rdfType,          dagRun,                                    GRAPH_MEMORY);
      memory.assert(run, dagVisitorQuery,  MemoryStore.lit.str(state.query),          GRAPH_MEMORY);
      memory.assert(run, dagRunTimestamp,  MemoryStore.lit.num(Date.now()),            GRAPH_MEMORY);
      for (const candidate of state.shortlist) {
        const book = MemoryStore.bookIri(candidate.book.isbn);
        // dag:shortlisted is the object property (run → book); dag:shortlistedTitle
        // is the literal convenience predicate kept for SPARQL compatibility.
        memory.assert(run, dagShortlisted,     book,                                           GRAPH_MEMORY);
        memory.assert(run, dagShortlistedTitle, MemoryStore.lit.str(candidate.book.title),     GRAPH_MEMORY);
      }
    }

    return { "output": 'recorded' };
  },
};
