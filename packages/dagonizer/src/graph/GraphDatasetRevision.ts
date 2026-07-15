import type * as RDF from '@rdfjs/types';
import { DataFactory, Writer } from 'n3';
import { _canonizeSync } from 'rdf-canonize';

import type { GraphDatasetInterface } from '../contracts/GraphDatasetInterface.js';
import type { LiteralTermType, QuadType, TermType } from '../contracts/TripleStoreInterface.js';

import { DagGraphTerms } from './DagGraphTerms.js';
import { GraphStateTerms } from './GraphStateTerms.js';

const REVISION_TRIPLE_GRAPH = DataFactory.namedNode('urn:dagonizer:revision:triple-term');
const REVISION_TRIPLE_TYPE = DataFactory.namedNode(DagGraphTerms.RDF_TYPE);
const REVISION_TRIPLE_TERM = DataFactory.namedNode(DagGraphTerms.RDF.TripleTerm);
const REVISION_TRIPLE_SUBJECT = DataFactory.namedNode(DagGraphTerms.RDF.ttSubject);
const REVISION_TRIPLE_PREDICATE = DataFactory.namedNode(DagGraphTerms.RDF.ttPredicate);
const REVISION_TRIPLE_OBJECT = DataFactory.namedNode(DagGraphTerms.RDF.ttObject);

/** Deterministic content revision for optimistic graph transactions. */
export class GraphDatasetRevision {
  private constructor() { /* static-only */ }

  static of(dataset: GraphDatasetInterface): string {
    return GraphDatasetRevision.ofQuads([...dataset.triples()].filter((quad) => quad.graph.termType !== 'NamedNode' || quad.graph.value !== GraphStateTerms.revisionGraphIri()));
  }

  static ofQuads(quads: Iterable<QuadType>): string {
    const source = [...quads].filter((quad) => quad.graph.termType !== 'NamedNode' || quad.graph.value !== GraphStateTerms.revisionGraphIri());
    const writer = new Writer<RDF.Quad>({ 'format': 'N-Quads' });
    const nquads = writer.quadsToString(expandForRevision(source));
    const canonical = source.some(containsNonGroundTerm)
      ? _canonizeSync(nquads, { 'algorithm': 'RDFC-1.0', 'inputFormat': 'application/n-quads' })
      : nquads.split('\n').filter((line) => line.length > 0).sort().join('\n');
    const digest = GraphDatasetRevision.sha256(canonical);
    return `graph-rev-${digest}`;
  }

  static sha256(value: string): string {
    const bytes = new TextEncoder().encode(value);
    const words = new Uint32Array(64);
    const state = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const word = (index: number): number => words[index] ?? 0;
    const hash = (index: number): number => state[index] ?? 0;
    const constants = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const bitLength = bytes.length * 8;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 4, bitLength, false);
    for (let offset = 0; offset < padded.length; offset += 64) {
      for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4, false);
      for (let i = 16; i < 64; i++) {
        const x = word(i - 15);
        const y = word(i - 2);
        words[i] = (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + word(i - 16) + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)) + word(i - 7);
      }
      let a = hash(0); let b = hash(1); let c = hash(2); let d = hash(3); let e = hash(4); let f = hash(5); let g = hash(6); let h = hash(7);
      for (let i = 0; i < 64; i++) {
        const sigma1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const choose = (e & f) ^ (~e & g);
        const temp1 = h + sigma1 + choose + (constants[i] ?? 0) + word(i);
        const sigma0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = sigma0 + majority;
        h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      state[0] = (hash(0) + a) >>> 0; state[1] = (hash(1) + b) >>> 0; state[2] = (hash(2) + c) >>> 0; state[3] = (hash(3) + d) >>> 0;
      state[4] = (hash(4) + e) >>> 0; state[5] = (hash(5) + f) >>> 0; state[6] = (hash(6) + g) >>> 0; state[7] = (hash(7) + h) >>> 0;
    }
    return [...state].map((word) => word.toString(16).padStart(8, '0')).join('');
  }
}

function containsNonGroundTerm(quad: QuadType): boolean {
  return [quad.subject, quad.predicate, quad.object, quad.graph].some(containsNonGroundTermInTerm);
}

function containsNonGroundTermInTerm(term: TermType): boolean {
  if (term.termType === 'BlankNode') return true;
  if (term.termType !== 'Quad') return false;
  return [term.quad.subject, term.quad.predicate, term.quad.object, term.quad.graph].some(containsNonGroundTermInTerm);
}

function expandForRevision(quads: readonly QuadType[]): RDF.Quad[] {
  const expanded: RDF.Quad[] = [];
  const context = { 'quads': expanded, 'nextTripleTerm': 0 };

  for (const quad of quads) {
    expanded.push(DataFactory.quad(
      toSubject(quad.subject, context),
      toPredicate(quad.predicate),
      toObject(quad.object, context),
      toGraph(quad.graph),
    ));
  }
  return expanded;
}

type RevisionExpansionContext = {
  readonly quads: RDF.Quad[];
  nextTripleTerm: number;
};

function toSubject(term: TermType, context: RevisionExpansionContext): RDF.Quad_Subject {
  if (term.termType === 'NamedNode') return DataFactory.namedNode(term.value);
  if (term.termType === 'BlankNode') return DataFactory.blankNode(term.value);
  if (term.termType === 'Variable') return DataFactory.variable(term.value);
  if (term.termType === 'Quad') return toTripleNode(term, context);
  throw new Error(`Invalid RDF subject term '${term.termType}'`);
}

function toPredicate(term: TermType): RDF.Quad_Predicate {
  if (term.termType === 'NamedNode') return DataFactory.namedNode(term.value);
  if (term.termType === 'Variable') return DataFactory.variable(term.value);
  throw new Error(`Invalid RDF predicate term '${term.termType}'`);
}

function toObject(term: TermType, context: RevisionExpansionContext): RDF.Quad_Object {
  if (term.termType === 'NamedNode') return DataFactory.namedNode(term.value);
  if (term.termType === 'BlankNode') return DataFactory.blankNode(term.value);
  if (term.termType === 'Variable') return DataFactory.variable(term.value);
  if (term.termType === 'Literal') return toLiteral(term);
  if (term.termType === 'Quad') return toTripleNode(term, context);
  throw new Error(`Invalid RDF object term '${term.termType}'`);
}

function toRevisionTerm(term: TermType, context: RevisionExpansionContext): RDF.Quad_Object {
  if (term.termType === 'Quad') return toTripleNode(term, context);
  if (term.termType === 'NamedNode') return DataFactory.namedNode(term.value);
  if (term.termType === 'BlankNode') return DataFactory.blankNode(term.value);
  if (term.termType === 'Variable') return DataFactory.variable(term.value);
  if (term.termType === 'Literal') return toLiteral(term);
  throw new Error(`Invalid RDF triple-term component '${term.termType}'`);
}

function toTripleNode(term: Extract<TermType, { termType: 'Quad' }>, context: RevisionExpansionContext): RDF.BlankNode {
  const tripleNode = DataFactory.blankNode(`revision-triple-${context.nextTripleTerm++}`);
  context.quads.push(
    DataFactory.quad(tripleNode, REVISION_TRIPLE_TYPE, REVISION_TRIPLE_TERM, REVISION_TRIPLE_GRAPH),
    DataFactory.quad(tripleNode, REVISION_TRIPLE_SUBJECT, toRevisionTerm(term.quad.subject, context), REVISION_TRIPLE_GRAPH),
    DataFactory.quad(tripleNode, REVISION_TRIPLE_PREDICATE, toRevisionTerm(term.quad.predicate, context), REVISION_TRIPLE_GRAPH),
    DataFactory.quad(tripleNode, REVISION_TRIPLE_OBJECT, toRevisionTerm(term.quad.object, context), REVISION_TRIPLE_GRAPH),
  );
  return tripleNode;
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
