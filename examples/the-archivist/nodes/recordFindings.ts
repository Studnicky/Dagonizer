/**
 * recordFindings: memory node.
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
 *     <run>  dag:shortlisted   <book>           (object property, links run to book URIs)
 *
 *   This is the canonical "deterministic memory write" node; same
 *   input candidates always produce the same triples, so a downstream
 *   SPARQL ASK gate can rely on the store as ground truth.
 */

import { NodeOutputBuilder, ScalarNode } from '@noocodex/dagonizer';
import type { NodeContextInterface } from '@noocodex/dagonizer';

import { GRAPH_MEMORY, MemoryStore } from '../memory/MemoryStore.ts';
import { PROV, ProvIris } from '../provenance/PROV.ts';
import type { ArchivistState } from '../ArchivistState.ts';
import type { ArchivistServices } from '../services.ts';

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
const dagEmbedding         = MemoryStore.dagIri('embedding');
const dagQueryEmbedding    = MemoryStore.dagIri('queryEmbedding');
// Dispatcher agent IRI: must mirror RdfProvObserver's constructor so
// the prov-graph agent we write to matches what the observer already
// asserted as type prov:SoftwareAgent.
const ARCHIVIST_AGENT      = ProvIris.agent('archivist-software');

export class RecordFindingsNode extends ScalarNode<ArchivistState, 'recorded', ArchivistServices> {
  readonly name = 'record-findings';
  readonly outputs = ['recorded'] as const;

  protected override async executeOne(state: ArchivistState, context: NodeContextInterface<ArchivistServices>) {
    const memory = context.services.memory;
    const embedder = context.services.embedder;
    const shortlistIsbns = new Set(state.shortlist.map((c) => c.book.identity.isbn));
    for (const candidate of state.candidates) {
      const book = MemoryStore.bookIri(candidate.book.identity.isbn);
      // rdf:type links this ABox instance to the TBox dag:Book class;
      // this is the triple that connects memory nodes to ontology class nodes
      // in the MemoryGraph cosmos.gl view.
      memory.assert(book, rdfType,        dagBook,                                                     GRAPH_MEMORY);
      memory.assert(book, dagTitle,       MemoryStore.lit.str(candidate.book.identity.title),          GRAPH_MEMORY);
      memory.assert(book, dagSource,      MemoryStore.lit.str(candidate.source),                       GRAPH_MEMORY);
      memory.assert(book, dagScore,       MemoryStore.lit.num(candidate.score),                        GRAPH_MEMORY);
      memory.assert(book, dagInShortlist, MemoryStore.lit.bool(shortlistIsbns.has(candidate.book.identity.isbn)), GRAPH_MEMORY);
    }

    // Per-run facts so future runs can recall this visitor's session.
    if (state.runId !== '') {
      const run = MemoryStore.runIri(state.runId);
      // rdf:type links this ABox run instance to the TBox dag:Run class.
      memory.assert(run, rdfType,          dagRun,                                    GRAPH_MEMORY);
      memory.assert(run, dagVisitorQuery,  MemoryStore.lit.str(state.query),          GRAPH_MEMORY);
      memory.assert(run, dagRunTimestamp,  MemoryStore.lit.num(Date.now()),            GRAPH_MEMORY);
      for (const candidate of state.shortlist) {
        const book = MemoryStore.bookIri(candidate.book.identity.isbn);
        // dag:shortlisted is the object property (run → book); dag:shortlistedTitle
        // is the literal convenience predicate kept for SPARQL compatibility.
        memory.assert(run, dagShortlisted,     book,                                                          GRAPH_MEMORY);
        memory.assert(run, dagShortlistedTitle, MemoryStore.lit.str(candidate.book.identity.title),            GRAPH_MEMORY);
      }

      // ── PROV-O bridge: connect every shortlisted Book (memory layer)
      //    to the Run Activity (prov layer) via prov:wasGeneratedBy +
      //    prov:wasAttributedTo. Without this bridge the visualiser
      //    shows two disconnected clusters (books + activities). The
      //    triples live in the run's prov-graph so the visualiser
      //    pulls the Book nodes into the prov layer's adjacency too;
      //    one connected graph, traversable via standard PROV-O
      //    predicates by recall / SPARQL.
      const provGraph    = MemoryStore.provGraphIri(state.runId);
      const runActivity  = ProvIris.activity(state.runId, 'run', 0);
      memory.assert(runActivity, MemoryStore.dagIri('searchedFor'), MemoryStore.lit.str(state.query), provGraph);
      for (const candidate of state.shortlist) {
        const book = MemoryStore.bookIri(candidate.book.identity.isbn);
        memory.assert(book,         PROV.wasGeneratedBy,   runActivity,      provGraph);
        memory.assert(book,         PROV.wasAttributedTo,  ARCHIVIST_AGENT,  provGraph);
        memory.assert(runActivity,  PROV.generated,        book,             provGraph);
        memory.assert(book,         dagSource,             MemoryStore.lit.str(candidate.source), provGraph);
      }
    }

    // ── Embedding writes (best-effort) ────────────────────────────────────
    // When the embedder service is wired and reachable, embed each
    // shortlisted candidate's "title + description" and the visitor's
    // query, and write them as JSON-encoded float-array literals onto the
    // book and run subjects. Cosine-based recallCandidates reads them back.
    //
    // Failure mode: any throw from embedder.embed() (rate limit, network
    // error, NO_ADAPTER_AVAILABLE drift, OOM on Ollama) is swallowed with
    // a single warn log; the embedding is opaque to the rest of the engine
    // so the absence of these triples is invisible to downstream nodes
    // that don't explicitly use embeddings.
    if (embedder !== null) {
      try {
        for (const candidate of state.shortlist) {
          const description = typeof candidate.notes?.['description'] === 'string'
            ? String(candidate.notes['description'])
            : '';
          const text = `${candidate.book.identity.title} ${description}`.trim();
          if (text.length === 0) continue;
          const vec = await embedder.embed(text);
          const book = MemoryStore.bookIri(candidate.book.identity.isbn);
          memory.assert(book, dagEmbedding, MemoryStore.lit.str(JSON.stringify([...vec])), GRAPH_MEMORY);
        }
        if (state.runId !== '' && state.query.length > 0) {
          const queryVec = await embedder.embed(state.query);
          const run = MemoryStore.runIri(state.runId);
          memory.assert(run, dagQueryEmbedding, MemoryStore.lit.str(JSON.stringify([...queryVec])), GRAPH_MEMORY);
        }
        context.services.logger.info(
          `record-findings: wrote ${String(state.shortlist.length)} book embeddings + run query embedding (dim=${String(embedder.dimensions)})`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        context.services.logger.warn(`record-findings: embedder unreachable, skipping embedding writes (fallback to Jaccard recall): ${message}`);
      }
    } else {
      context.services.logger.info('record-findings: embedder unreachable, skipping embedding writes (fallback to Jaccard recall)');
    }

    return NodeOutputBuilder.of('recorded');
  }
}

/** Backward-compatible const export for existing bundle/DAG references. */
export const recordFindings = new RecordFindingsNode();
