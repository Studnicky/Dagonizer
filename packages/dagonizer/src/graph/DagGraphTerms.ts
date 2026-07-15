import type { LiteralTermType, NamedNodeTermType, QuadType, TermType } from '../contracts/TripleStoreInterface.js';

export class DagGraphTerms {
  private constructor() { /* static-only */ }

  static readonly DAGONIZER = 'https://noocodec.dev/ontology/dagonizer/';
  static readonly RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
  static readonly XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';
  static readonly DEFAULT_GRAPH = 'urn:dagonizer:default-graph';

  static namedNode(value: string): NamedNodeTermType {
    return { 'termType': 'NamedNode', value };
  }

  static literal(value: string, datatype?: string, language?: string): LiteralTermType {
    if (language !== undefined && language.length > 0) return { 'termType': 'Literal', value, language };
    if (datatype !== undefined && datatype !== DagGraphTerms.XSD_STRING) return { 'termType': 'Literal', value, "datatype": DagGraphTerms.namedNode(datatype) };
    return { 'termType': 'Literal', value };
  }

  static defaultGraph(): TermType {
    return { 'termType': 'DefaultGraph', 'value': '' };
  }

  static tripleTerm(subject: TermType, predicate: TermType, object: TermType): TermType {
    return {
      'termType': 'Quad',
      'value': '',
      'quad': { subject, predicate, object, 'graph': DagGraphTerms.defaultGraph() },
    };
  }

  static quadTerm(quad: QuadType): TermType {
    return { 'termType': 'Quad', 'value': '', quad };
  }

  static class(localName: string): TermType {
    return DagGraphTerms.namedNode(`${DagGraphTerms.DAGONIZER}${localName}`);
  }

  static predicate(localName: string): TermType {
    return DagGraphTerms.namedNode(`${DagGraphTerms.DAGONIZER}${localName}`);
  }
}
