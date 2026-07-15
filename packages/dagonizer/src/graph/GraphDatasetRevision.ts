import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

import type * as RDF from '@rdfjs/types';
import { DataFactory, Writer } from 'n3';

import type { GraphDatasetInterface } from '../contracts/GraphDatasetInterface.js';
import type { LiteralTermType, QuadType, TermType } from '../contracts/TripleStoreInterface.js';

import { GraphStateTerms } from './GraphStateTerms.js';

const require = createRequire(import.meta.url);
const rdfCanonize: {
  _canonizeSync(input: string, options: { algorithm: 'RDFC-1.0'; inputFormat: 'application/n-quads' }): string;
} = require('rdf-canonize');

/** Deterministic content revision for optimistic graph transactions. */
export class GraphDatasetRevision {
  private constructor() { /* static-only */ }

  static of(dataset: GraphDatasetInterface): string {
    return GraphDatasetRevision.ofQuads([...dataset.triples()].filter((quad) => quad.graph.termType !== 'NamedNode' || quad.graph.value !== GraphStateTerms.revisionGraphIri()));
  }

  static ofQuads(quads: Iterable<QuadType>): string {
    const writer = new Writer<RDF.Quad>({ 'format': 'N-Quads' });
    const nquads = writer.quadsToString([...quads]
      .filter((quad) => quad.graph.termType !== 'NamedNode' || quad.graph.value !== GraphStateTerms.revisionGraphIri())
      .map(toRdfQuad));
    const canonical = rdfCanonize._canonizeSync(nquads, { 'algorithm': 'RDFC-1.0', 'inputFormat': 'application/n-quads' });
    const digest = createHash('sha256').update(canonical).digest('hex');
    return `graph-rev-${digest}`;
  }
}

function toRdfQuad(quad: QuadType): RDF.Quad {
  return DataFactory.quad(toSubject(quad.subject), toPredicate(quad.predicate), toObject(quad.object), toGraph(quad.graph));
}

function toSubject(term: TermType): RDF.Quad_Subject {
  if (term.termType === 'NamedNode') return DataFactory.namedNode(term.value);
  if (term.termType === 'BlankNode') return DataFactory.blankNode(term.value);
  if (term.termType === 'Variable') return DataFactory.variable(term.value);
  if (term.termType === 'Quad') return toRdfQuad(term.quad);
  throw new Error(`Invalid RDF subject term '${term.termType}'`);
}

function toPredicate(term: TermType): RDF.Quad_Predicate {
  if (term.termType === 'NamedNode') return DataFactory.namedNode(term.value);
  if (term.termType === 'Variable') return DataFactory.variable(term.value);
  throw new Error(`Invalid RDF predicate term '${term.termType}'`);
}

function toObject(term: TermType): RDF.Quad_Object {
  if (term.termType === 'NamedNode') return DataFactory.namedNode(term.value);
  if (term.termType === 'BlankNode') return DataFactory.blankNode(term.value);
  if (term.termType === 'Variable') return DataFactory.variable(term.value);
  if (term.termType === 'Literal') return toLiteral(term);
  if (term.termType === 'Quad') return toRdfQuad(term.quad);
  throw new Error(`Invalid RDF object term '${term.termType}'`);
}

function toLiteral(term: LiteralTermType): RDF.Literal {
  if (term.language !== undefined) return DataFactory.literal(term.value, term.language);
  return DataFactory.literal(term.value, term.datatype === undefined ? undefined : DataFactory.namedNode(term.datatype.value));
}

function toGraph(term: TermType): RDF.Quad_Graph {
  if (term.termType === 'NamedNode') return DataFactory.namedNode(term.value);
  if (term.termType === 'BlankNode') return DataFactory.blankNode(term.value);
  if (term.termType === 'DefaultGraph') return DataFactory.defaultGraph();
  throw new Error(`Invalid RDF graph term '${term.termType}'`);
}
