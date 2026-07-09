import type { TermType } from '../contracts/TripleStoreInterface.js';

export class DagGraphTerms {
  private constructor() { /* static-only */ }

  static readonly DAGONIZER = 'https://noocodec.dev/ontology/dagonizer/';
  static readonly RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
  static readonly DEFAULT_GRAPH = 'urn:dagonizer:default-graph';

  static namedNode(value: string): TermType {
    return { 'termType': 'NamedNode', value };
  }

  static literal(value: string): TermType {
    return { 'termType': 'Literal', value };
  }

  static defaultGraph(): TermType {
    return { 'termType': 'DefaultGraph', 'value': '' };
  }

  static class(localName: string): TermType {
    return DagGraphTerms.namedNode(`${DagGraphTerms.DAGONIZER}${localName}`);
  }

  static predicate(localName: string): TermType {
    return DagGraphTerms.namedNode(`${DagGraphTerms.DAGONIZER}${localName}`);
  }
}
