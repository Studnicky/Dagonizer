import type { QuadType, TermType } from '../contracts/TripleStoreInterface.js';

/**
 * Deterministic blank-node skolemization for the journal boundary.
 *
 * N-Quads round-trips relabel blank nodes on every parse, so a delete
 * pattern built from a freshly-parsed quad never matches the blank node
 * it was meant to remove. Skolemizing every blank node to a run-scoped
 * IRI before serialization, and de-skolemizing back to a blank node with
 * the same label on replay, keeps blank node identity stable across the
 * journal's N-Quads encode/decode boundary.
 */
export class GraphSkolemizer {
  private constructor() { /* static-only */ }

  static readonly PREFIX = 'urn:dagonizer:skolem:';

  static skolemize(quads: readonly QuadType[], runIri: string): QuadType[] {
    return quads.map((quad) => GraphSkolemizer.#skolemizeQuad(quad, runIri));
  }

  static deskolemize(quads: readonly QuadType[], runIri: string): QuadType[] {
    return quads.map((quad) => GraphSkolemizer.#deskolemizeQuad(quad, runIri));
  }

  static #skolemizeQuad(quad: QuadType, runIri: string): QuadType {
    return {
      "subject": GraphSkolemizer.#skolemizeTerm(quad.subject, runIri),
      "predicate": GraphSkolemizer.#skolemizeTerm(quad.predicate, runIri),
      "object": GraphSkolemizer.#skolemizeTerm(quad.object, runIri),
      "graph": GraphSkolemizer.#skolemizeTerm(quad.graph, runIri),
    };
  }

  static #deskolemizeQuad(quad: QuadType, runIri: string): QuadType {
    return {
      "subject": GraphSkolemizer.#deskolemizeTerm(quad.subject, runIri),
      "predicate": GraphSkolemizer.#deskolemizeTerm(quad.predicate, runIri),
      "object": GraphSkolemizer.#deskolemizeTerm(quad.object, runIri),
      "graph": GraphSkolemizer.#deskolemizeTerm(quad.graph, runIri),
    };
  }

  static #skolemizeTerm(term: TermType, runIri: string): TermType {
    if (term.termType === 'BlankNode') return { "termType": 'NamedNode', "value": GraphSkolemizer.#skolemIri(runIri, term.value) };
    if (term.termType === 'Quad') return { "termType": 'Quad', "value": '', "quad": GraphSkolemizer.#skolemizeQuad(term.quad, runIri) };
    return term;
  }

  static #deskolemizeTerm(term: TermType, runIri: string): TermType {
    if (term.termType === 'NamedNode') {
      const label = GraphSkolemizer.#skolemLabel(term.value, runIri);
      if (label !== undefined) return { "termType": 'BlankNode', "value": label };
      return term;
    }
    if (term.termType === 'Quad') return { "termType": 'Quad', "value": '', "quad": GraphSkolemizer.#deskolemizeQuad(term.quad, runIri) };
    return term;
  }

  static #skolemIri(runIri: string, label: string): string {
    return `${GraphSkolemizer.PREFIX}${runIri}:${label}`;
  }

  static #skolemLabel(iri: string, runIri: string): string | undefined {
    const prefix = `${GraphSkolemizer.PREFIX}${runIri}:`;
    return iri.startsWith(prefix) ? iri.slice(prefix.length) : undefined;
  }
}
