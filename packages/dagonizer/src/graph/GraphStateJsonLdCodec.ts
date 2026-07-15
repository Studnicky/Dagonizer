import type { GraphStateJsonLdDocumentType, GraphStateJsonLdValueType } from '../contracts/GraphStateJsonLd.js';
import type { QuadType, TermType } from '../contracts/TripleStoreInterface.js';
import { ContextResolver } from '../dag/ContextResolver.js';

import { DagGraphTerms } from './DagGraphTerms.js';
import { GraphStateTerms } from './GraphStateTerms.js';

/** Converts graph-state quads to and from the context-bound Node.js JSON IR. */
export class GraphStateJsonLdCodec {
  private constructor() { /* static-only */ }

  static encode(quads: Iterable<QuadType>, context: Record<string, unknown> = GraphStateTerms.JSON_LD_CONTEXT): GraphStateJsonLdDocumentType {
    const graphs = new Map<string, Map<string, MutableGraphStateJsonLdNode>>();
    for (const quad of quads) {
      if (quad.predicate.termType !== 'NamedNode') throw new Error('JSON-LD graph state requires named-node predicates');
      if (quad.subject.termType !== 'NamedNode' && quad.subject.termType !== 'BlankNode') throw new Error('JSON-LD graph state requires named-node or blank-node subjects');
      if (quad.graph.termType !== 'NamedNode' && quad.graph.termType !== 'DefaultGraph') throw new Error('JSON-LD graph state requires named or default graphs');
      const graphKey = quad.graph.termType === 'DefaultGraph' ? '' : quad.graph.value;
      const subjects = graphs.get(graphKey) ?? new Map<string, MutableGraphStateJsonLdNode>();
      const subjectKey = `${quad.subject.termType}:${quad.subject.value}`;
      const node = subjects.get(subjectKey) ?? { '@id': GraphStateJsonLdCodec.compactIri(quad.subject.value, context) };
      const predicate = quad.predicate.value === DagGraphTerms.RDF_TYPE ? '@type' : GraphStateJsonLdCodec.compactIri(quad.predicate.value, context);
      const value = GraphStateJsonLdCodec.encodeObject(quad.object, context, quad.predicate.value === DagGraphTerms.RDF_TYPE);
      const previous = node[predicate];
      if (Array.isArray(previous)) previous.push(value);
      else if (previous === undefined) node[predicate] = [value];
      else if (typeof previous === 'string') throw new Error(`JSON-LD graph state predicate '${predicate}' conflicts with a reserved string field`);
      else node[predicate] = [previous, value];
      subjects.set(subjectKey, node);
      graphs.set(graphKey, subjects);
    }
    return {
      '@context': { ...context },
      '@graph': [...graphs.entries()].map(([graphIri, subjects]) => ({ ...(graphIri.length === 0 ? {} : { '@id': GraphStateJsonLdCodec.compactIri(graphIri, context) }), '@graph': [...subjects.values()] })),
    };
  }

  static decode(document: GraphStateJsonLdDocumentType): QuadType[] {
    const context = document['@context'];
    const quads: QuadType[] = [];
    for (const graph of document['@graph']) {
      const graphTerm = graph['@id'] === undefined ? DagGraphTerms.defaultGraph() : DagGraphTerms.namedNode(ContextResolver.expandTerm(graph['@id'], context));
      for (const node of graph['@graph']) {
        const subject = GraphStateJsonLdCodec.decodeId(node['@id'], context);
        for (const [predicateKey, raw] of Object.entries(node)) {
          if (predicateKey === '@id') continue;
          const isType = predicateKey === '@type';
          const predicate = isType ? DagGraphTerms.namedNode(DagGraphTerms.RDF_TYPE) : DagGraphTerms.namedNode(ContextResolver.expandTerm(predicateKey, context));
          const values = Array.isArray(raw) ? raw : [raw];
          for (const value of values) quads.push({ 'subject': subject, predicate, 'object': GraphStateJsonLdCodec.decodeObject(value, context, isType), 'graph': graphTerm });
        }
      }
    }
    return quads;
  }

  static rebase(quads: Iterable<QuadType>, runIri: string): QuadType[] {
    const sourceGraph = [...quads].find((quad) => quad.graph.termType === 'NamedNode')?.graph.value;
    if (sourceGraph === undefined || !sourceGraph.endsWith('#state')) return [...quads];
    const sourceRunIri = sourceGraph.slice(0, -'#state'.length);
    if (sourceRunIri === runIri) return [...quads];
    return [...quads].map((quad) => ({
      'subject': GraphStateJsonLdCodec.rebaseTerm(quad.subject, sourceRunIri, runIri),
      'predicate': GraphStateJsonLdCodec.rebaseTerm(quad.predicate, sourceRunIri, runIri),
      'object': GraphStateJsonLdCodec.rebaseTerm(quad.object, sourceRunIri, runIri),
      'graph': GraphStateJsonLdCodec.rebaseTerm(quad.graph, sourceRunIri, runIri),
    }));
  }

  static async *asyncQuads(quads: Iterable<QuadType>): AsyncIterable<QuadType> {
    yield* quads;
  }

  private static encodeObject(term: TermType, context: Record<string, unknown>, typeObject: boolean): GraphStateJsonLdValueType {
    if (term.termType === 'NamedNode' || term.termType === 'BlankNode') {
      if (typeObject) return GraphStateJsonLdCodec.compactIri(term.value, context);
      return { '@id': GraphStateJsonLdCodec.compactIri(term.value, context) };
    }
    if (term.termType === 'Literal') return {
      '@value': term.value,
      ...(term.language === undefined ? {} : { '@language': term.language }),
      ...(term.language === undefined && term.datatype !== undefined ? { '@type': GraphStateJsonLdCodec.compactIri(term.datatype.value, context) } : {}),
    };
    if (term.termType === 'Quad') {
      return {
        '@type': GraphStateJsonLdCodec.compactIri(DagGraphTerms.RDF.TripleTerm, context),
        [GraphStateJsonLdCodec.compactIri(DagGraphTerms.RDF.ttSubject, context)]: GraphStateJsonLdCodec.encodeObject(term.quad.subject, context, false),
        [GraphStateJsonLdCodec.compactIri(DagGraphTerms.RDF.ttPredicate, context)]: GraphStateJsonLdCodec.encodeObject(term.quad.predicate, context, false),
        [GraphStateJsonLdCodec.compactIri(DagGraphTerms.RDF.ttObject, context)]: GraphStateJsonLdCodec.encodeObject(term.quad.object, context, false),
      };
    }
    throw new Error(`JSON-LD graph state cannot encode RDF term '${term.termType}'`);
  }

  private static decodeObject(value: unknown, context: Record<string, unknown>, typeObject: boolean): TermType {
    if (typeObject && typeof value === 'string') return GraphStateJsonLdCodec.decodeId(value, context);
    if (GraphStateJsonLdCodec.isTripleTermNode(value, context)) {
      const subject = GraphStateJsonLdCodec.decodeObject(GraphStateJsonLdCodec.property(value, DagGraphTerms.RDF.ttSubject, context), context, false);
      const predicate = GraphStateJsonLdCodec.decodeObject(GraphStateJsonLdCodec.property(value, DagGraphTerms.RDF.ttPredicate, context), context, false);
      const object = GraphStateJsonLdCodec.decodeObject(GraphStateJsonLdCodec.property(value, DagGraphTerms.RDF.ttObject, context), context, false);
      if (predicate.termType !== 'NamedNode') throw new Error('JSON-LD graph state contains an invalid RDF triple-term predicate');
      return DagGraphTerms.tripleTerm(subject, predicate, object);
    }
    if (GraphStateJsonLdCodec.isRecord(value) && typeof value['@id'] === 'string') return GraphStateJsonLdCodec.decodeId(value['@id'], context);
    if (GraphStateJsonLdCodec.isRecord(value) && typeof value['@value'] === 'string') {
      const datatype = typeof value['@type'] === 'string' ? ContextResolver.expandTerm(value['@type'], context) : undefined;
      const language = typeof value['@language'] === 'string' ? value['@language'] : undefined;
      return DagGraphTerms.literal(value['@value'], datatype, language);
    }
    throw new Error('JSON-LD graph state contains an invalid RDF object');
  }

  private static decodeId(value: string, context: Record<string, unknown>): TermType {
    if (value.startsWith('_:')) return { 'termType': 'BlankNode', 'value': value.slice(2) };
    return DagGraphTerms.namedNode(ContextResolver.expandTerm(value, context));
  }

  private static rebaseTerm(term: TermType, sourceRunIri: string, targetRunIri: string): TermType {
    if (term.termType === 'Quad') return {
      'termType': 'Quad',
      'value': '',
      'quad': {
        'subject': GraphStateJsonLdCodec.rebaseTerm(term.quad.subject, sourceRunIri, targetRunIri),
        'predicate': GraphStateJsonLdCodec.rebaseTerm(term.quad.predicate, sourceRunIri, targetRunIri),
        'object': GraphStateJsonLdCodec.rebaseTerm(term.quad.object, sourceRunIri, targetRunIri),
        'graph': GraphStateJsonLdCodec.rebaseTerm(term.quad.graph, sourceRunIri, targetRunIri),
      },
    };
    if (term.termType !== 'NamedNode') return term;
    const value = term.value === sourceRunIri || term.value.startsWith(`${sourceRunIri}/`) || term.value.startsWith(`${sourceRunIri}#`)
      ? `${targetRunIri}${term.value.slice(sourceRunIri.length)}`
      : term.value;
    return { 'termType': 'NamedNode', value };
  }

  private static compactIri(iri: string, context: Record<string, unknown>): string {
    return ContextResolver.compactTerm(iri, context);
  }

  private static isTripleTermNode(value: unknown, context: Record<string, unknown>): value is Record<string, unknown> {
    if (!GraphStateJsonLdCodec.isRecord(value)) return false;
    const type = value['@type'];
    const tripleTerm = GraphStateJsonLdCodec.compactIri(DagGraphTerms.RDF.TripleTerm, context);
    return (type === tripleTerm || type === DagGraphTerms.RDF.TripleTerm)
      && GraphStateJsonLdCodec.property(value, DagGraphTerms.RDF.ttSubject, context) !== undefined
      && GraphStateJsonLdCodec.property(value, DagGraphTerms.RDF.ttPredicate, context) !== undefined
      && GraphStateJsonLdCodec.property(value, DagGraphTerms.RDF.ttObject, context) !== undefined;
  }

  private static property(value: Record<string, unknown>, iri: string, context: Record<string, unknown>): unknown {
    const compact = GraphStateJsonLdCodec.compactIri(iri, context);
    for (const [key, candidate] of Object.entries(value)) {
      if (key === compact || key === iri) return Array.isArray(candidate) ? candidate[0] : candidate;
      if (!key.startsWith('@') && ContextResolver.expandTerm(key, context) === iri) return Array.isArray(candidate) ? candidate[0] : candidate;
    }
    return undefined;
  }

  private static isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}

type MutableGraphStateJsonLdNode = {
  '@id': string;
  [predicate: string]: GraphStateJsonLdValueType | GraphStateJsonLdValueType[] | string;
};
