/**
 * StateProjection: mirror ArchivistState into `urn:dagonizer:state:<runId>`.
 *
 * The named graph is canonical: nodes that need cross-cutting facts
 * SPARQL the graph (`store.select({...,graph: MemoryStore.stateGraphIri(runId)})`).
 * Typed property access on `ArchivistState` is the WRITE path; this
 * projection mirrors every set into RDF, so the graph is always in
 * sync with the typed view.
 *
 * Wiring:
 *   - Call `project(state, store)` after every `onNodeEnd` (the
 *     ObservedDag subclass does this automatically).
 *   - Call `clear(state, store)` on flow start so a fresh run begins
 *     with no leftover triples in the run's named graph.
 *
 * Field → predicate mapping uses the `dag:` vocabulary; one predicate
 * per typed field. Multi-valued fields (terms, candidates, shortlist)
 * unwind to one triple per element so SPARQL can `?run dag:term ?t`.
 */

import type { NamedNode } from 'n3';

import type { ArchivistState } from '../ArchivistState.ts';
import { MemoryStore } from '../memory/MemoryStore.ts';

const dag     = (local: string): NamedNode => MemoryStore.dagIri(local);
const rdfType = MemoryStore.iri('http://www.w3.org/1999/02/22-rdf-syntax-ns#type');
const dagBook = MemoryStore.dagIri('Book');
const dagRun  = MemoryStore.dagIri('Run');

export class StateProjection {
  /** Wipe everything in the per-run state graph. */
  static clear(runId: string, store: MemoryStore): void {
    store.clearGraph(MemoryStore.stateGraphIri(runId));
  }

  /**
   * Project the current typed state into the per-run state graph. Idempotent:
   * we clear the graph and re-write so the snapshot is always fresh.
   */
  static project(state: ArchivistState, store: MemoryStore): void {
    if (state.runId === '') return;
    const graph = MemoryStore.stateGraphIri(state.runId);
    store.clearGraph(graph);
    const run = MemoryStore.runIri(state.runId);

    // rdf:type links this ABox run instance to the TBox dag:Run class;
    // connects the state graph to the ontology graph in the MemoryGraph view.
    store.assert(run, rdfType, dagRun, graph);

    // Scalar fields
    store.assert(run, dag('visitorQuery'), MemoryStore.lit.str(state.query), graph);
    store.assert(run, dag('intent'),       MemoryStore.lit.str(state.intent), graph);
    store.assert(run, dag('draft'),        MemoryStore.lit.str(state.draft), graph);
    if (state.approvalState !== 'pending') {
      store.assert(run, dag('approved'), MemoryStore.lit.bool(state.approvalState === 'approved'), graph);
    }

    // Compose attempts counter (from the conceptual-root retry budget)
    const attempts = state.retriesFor('compose');
    store.assert(run, dag('composeAttempts'), MemoryStore.lit.int(attempts), graph);

    // Search terms: one triple per term
    for (const term of state.terms) {
      store.assert(run, dag('term'), MemoryStore.lit.str(term), graph);
    }

    // Candidates: full book metadata + scoring per candidate
    for (const candidate of state.candidates) {
      const book = MemoryStore.bookIri(candidate.book.identity.isbn);
      // rdf:type links this ABox book instance to the TBox dag:Book class;
      // connects the state graph to the ontology graph in the MemoryGraph view.
      store.assert(book, rdfType,          dagBook,                                                   graph);
      store.assert(run,  dag('candidate'), book,                                                      graph);
      store.assert(book, dag('title'),     MemoryStore.lit.str(candidate.book.identity.title),        graph);
      store.assert(book, dag('source'),    MemoryStore.lit.str(candidate.source),                     graph);
      store.assert(book, dag('score'),     MemoryStore.lit.num(candidate.score),                      graph);
      for (const author of candidate.book.identity.authors) {
        store.assert(book, dag('author'), MemoryStore.lit.str(author), graph);
      }
      if (candidate.book.publication.summary !== null) {
        store.assert(book, dag('summary'), MemoryStore.lit.str(candidate.book.publication.summary), graph);
      }
      if (candidate.book.publication.firstPublishYear !== null) {
        store.assert(book, dag('firstPublishYear'), MemoryStore.lit.int(candidate.book.publication.firstPublishYear), graph);
      }
      for (const subject of candidate.book.publication.subjects) {
        store.assert(book, dag('subject'), MemoryStore.lit.str(subject), graph);
      }
      if (candidate.reason !== undefined) {
        store.assert(book, dag('rankReason'), MemoryStore.lit.str(candidate.reason), graph);
      }
      if (candidate.notes !== undefined) {
        for (const [k, v] of Object.entries(candidate.notes)) {
          store.assert(book, dag(`note:${k}`), MemoryStore.lit.str(JSON.stringify(v)), graph);
        }
      }
    }

    // Shortlist: flagged via dag:inShortlist on the book
    const shortlistIsbns = new Set(state.shortlist.map((c) => c.book.identity.isbn));
    for (const candidate of state.candidates) {
      const book = MemoryStore.bookIri(candidate.book.identity.isbn);
      store.assert(book, dag('inShortlist'),
        MemoryStore.lit.bool(shortlistIsbns.has(candidate.book.identity.isbn)), graph);
    }

    // ToolInterface plan: one triple per planned call
    for (const call of state.toolPlan) {
      store.assert(run, dag('toolPlanned'), MemoryStore.lit.str(call.name), graph);
    }
  }
}
