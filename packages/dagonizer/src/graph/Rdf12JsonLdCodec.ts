import type { DataFactory as RdfDataFactory, Quad, Quad_Object, Quad_Predicate, Quad_Subject, Term } from '@rdfjs/types';
import type { ContextDefinition, JsonLdDocument } from 'jsonld';
import jsonld from 'jsonld';
import { DataFactory } from 'n3';

import { DagGraphTerms } from './DagGraphTerms.js';

const factory: RdfDataFactory = DataFactory;

type JsonLdInput = object | string;
type ParseOptions = {
  readonly baseIRI?: string;
  readonly context?: ContextDefinition;
};
type SerializeOptions = {
  readonly baseIRI?: string;
  readonly context?: ContextDefinition;
  readonly excludeContext?: boolean;
  readonly space?: number | string;
  readonly useNativeTypes?: boolean;
  readonly useRdfType?: boolean;
};
type BasicEncoding = {
  readonly subject: Quad;
  readonly predicate: Quad;
  readonly object: Quad;
  readonly type: Quad;
};
type EncodingContext = {
  readonly quads: Quad[];
  readonly nodes: Map<string, ReturnType<typeof factory.blankNode>>;
  nextNode: number;
};

/** JSON-LD 1.1 boundary using RDF 1.2 Basic Encoding for triple terms. */
export class Rdf12JsonLdCodec {
  private constructor() { /* static-only */ }

  static async parse(input: JsonLdInput, options: ParseOptions = {}): Promise<readonly Quad[]> {
    const parsed: JsonLdDocument = JSON.parse(typeof input === 'string' ? input : JSON.stringify(input));
    const document = options.context !== undefined && !Array.isArray(parsed) && parsed['@context'] === undefined
      ? { ...parsed, '@context': options.context }
      : parsed;
    const dataset = await jsonld.toRDF(document, { 'base': options.baseIRI });
    if (!Array.isArray(dataset) || !dataset.every(Rdf12JsonLdCodec.isQuad)) throw new Error('JSON-LD processor returned an invalid RDF dataset');
    return Rdf12JsonLdCodec.decodeBasicEncoding(dataset);
  }

  static async serialize(quads: Iterable<Quad>, options: SerializeOptions = {}): Promise<string> {
    const source = [...quads];
    for (const quad of source) Rdf12JsonLdCodec.validateQuad(quad);
    const basic = Rdf12JsonLdCodec.encodeBasicEncoding(source);
    const expanded = await jsonld.fromRDF(basic, {
      'useNativeTypes': options.useNativeTypes,
      'useRdfType': options.useRdfType,
    });
    const document = options.context !== undefined && options.excludeContext !== true
      ? await jsonld.compact(expanded, options.context, { 'compactArrays': false, 'base': options.baseIRI })
      : expanded;
    return JSON.stringify(document, null, options.space);
  }

  private static encodeBasicEncoding(quads: readonly Quad[]): readonly Quad[] {
    const context: EncodingContext = { 'quads': [], 'nodes': new Map(), 'nextNode': 0 };
    for (const quad of quads) {
      const graph = Rdf12JsonLdCodec.toGraph(quad.graph);
      const subject = Rdf12JsonLdCodec.toSubject(quad.subject);
      const predicate = Rdf12JsonLdCodec.toPredicate(quad.predicate);
      const object = Rdf12JsonLdCodec.toObject(quad.object, graph, context);
      context.quads.push(factory.quad(subject, predicate, object, graph));
    }
    return context.quads;
  }

  private static toSubject(term: Term): Quad_Subject {
    if (term.termType === 'NamedNode') return factory.namedNode(term.value);
    if (term.termType === 'BlankNode') return factory.blankNode(term.value);
    throw new Error(`RDF 1.2 JSON-LD requires named-node or blank-node subjects, received '${term.termType}'`);
  }

  private static toPredicate(term: Term): Quad_Predicate {
    if (term.termType === 'NamedNode') return factory.namedNode(term.value);
    throw new Error(`RDF 1.2 JSON-LD requires named-node predicates, received '${term.termType}'`);
  }

  private static toObject(term: Term, graph: Quad['graph'], context: EncodingContext): Quad_Object {
    if (term.termType === 'Quad') return Rdf12JsonLdCodec.toTripleTerm(term, graph, context);
    if (term.termType === 'NamedNode') return factory.namedNode(term.value);
    if (term.termType === 'BlankNode') return factory.blankNode(term.value);
    if (term.termType === 'Literal') return typeof term.language === 'string' && term.language.length > 0
      ? factory.literal(term.value, term.language)
      : factory.literal(term.value, factory.namedNode(term.datatype.value));
    throw new Error(`RDF 1.2 JSON-LD cannot encode object term '${term.termType}'`);
  }

  private static toTripleTerm(term: Extract<Term, { termType: 'Quad' }>, graph: Quad['graph'], context: EncodingContext): ReturnType<typeof factory.blankNode> {
    const key = Rdf12JsonLdCodec.tripleKey(term, graph);
    const existing = context.nodes.get(key);
    if (existing !== undefined) return existing;
    const node = factory.blankNode(`jsonld-triple-term-${context.nextNode++}`);
    context.nodes.set(key, node);
    const subject = Rdf12JsonLdCodec.toTripleSubject(term.subject);
    const predicate = Rdf12JsonLdCodec.toTriplePredicate(term.predicate);
    const object = Rdf12JsonLdCodec.toObject(term.object, graph, context);
    context.quads.push(
      factory.quad(node, factory.namedNode(DagGraphTerms.RDF_TYPE), factory.namedNode(DagGraphTerms.RDF.TripleTerm), graph),
      factory.quad(node, factory.namedNode(DagGraphTerms.RDF.ttSubject), subject, graph),
      factory.quad(node, factory.namedNode(DagGraphTerms.RDF.ttPredicate), predicate, graph),
      factory.quad(node, factory.namedNode(DagGraphTerms.RDF.ttObject), object, graph),
    );
    return node;
  }

  private static toTripleSubject(term: Term): Quad_Object {
    if (term.termType === 'NamedNode') return factory.namedNode(term.value);
    if (term.termType === 'BlankNode') return factory.blankNode(term.value);
    throw new Error(`RDF 1.2 triple-term subjects cannot be '${term.termType}'`);
  }

  private static toTriplePredicate(term: Term): Quad_Object {
    if (term.termType === 'NamedNode') return factory.namedNode(term.value);
    throw new Error(`RDF 1.2 triple-term predicates cannot be '${term.termType}'`);
  }

  private static decodeBasicEncoding(quads: readonly Quad[]): readonly Quad[] {
    const encodings = Rdf12JsonLdCodec.findEncodings(quads);
    const generated = new Set<string>();
    for (const [key, encoding] of encodings) {
      generated.add(Rdf12JsonLdCodec.quadKey(encoding.type));
      generated.add(Rdf12JsonLdCodec.quadKey(encoding.subject));
      generated.add(Rdf12JsonLdCodec.quadKey(encoding.predicate));
      generated.add(Rdf12JsonLdCodec.quadKey(encoding.object));
      if (quads.some((quad) => Rdf12JsonLdCodec.sameTerm(quad.subject, encoding.type.subject)
        && !Rdf12JsonLdCodec.isEncodingPredicate(quad.predicate))) {
        throw new Error(`RDF 1.2 Basic Encoding node '${key}' contains non-encoding properties`);
      }
    }
    return quads.filter((quad) => !generated.has(Rdf12JsonLdCodec.quadKey(quad))).map((quad) => factory.quad(
      Rdf12JsonLdCodec.decodeSubject(quad.subject, encodings),
      Rdf12JsonLdCodec.decodePredicate(quad.predicate),
      Rdf12JsonLdCodec.decodeObject(quad.object, encodings, new Set()),
      Rdf12JsonLdCodec.decodeGraph(quad.graph),
    ));
  }

  private static findEncodings(quads: readonly Quad[]): Map<string, BasicEncoding> {
    const groups = new Map<string, Quad[]>();
    for (const quad of quads) {
      if (quad.subject.termType !== 'BlankNode') continue;
      const key = Rdf12JsonLdCodec.nodeKey(quad.subject);
      const group = groups.get(key) ?? [];
      group.push(quad);
      groups.set(key, group);
    }
    const result = new Map<string, BasicEncoding>();
    for (const [key, group] of groups) {
      const type = Rdf12JsonLdCodec.single(group, DagGraphTerms.RDF_TYPE);
      const subject = Rdf12JsonLdCodec.single(group, DagGraphTerms.RDF.ttSubject);
      const predicate = Rdf12JsonLdCodec.single(group, DagGraphTerms.RDF.ttPredicate);
      const object = Rdf12JsonLdCodec.single(group, DagGraphTerms.RDF.ttObject);
      if (type === undefined || type.object.termType !== 'NamedNode' || type.object.value !== DagGraphTerms.RDF.TripleTerm
        || subject === undefined || predicate === undefined || object === undefined) continue;
      if (group.length !== 4) throw new Error(`RDF 1.2 Basic Encoding node '${key}' contains duplicate or non-encoding properties`);
      result.set(key, { type, subject, predicate, object });
    }
    return result;
  }

  private static single(quads: readonly Quad[], predicate: string): Quad | undefined {
    const matches = quads.filter((quad) => quad.predicate.termType === 'NamedNode' && quad.predicate.value === predicate);
    return matches.length === 1 ? matches[0] : undefined;
  }

  private static decodeSubject(term: Quad_Subject, encodings: ReadonlyMap<string, BasicEncoding>): Quad_Subject {
    if (term.termType !== 'BlankNode') return term;
    const encoding = encodings.get(Rdf12JsonLdCodec.nodeKey(term));
    if (encoding === undefined) return term;
    throw new Error(`RDF 1.2 triple term '${encoding.type.subject.value}' cannot appear in subject position`);
  }

  private static decodePredicate(term: Quad_Predicate): Quad_Predicate {
    if (term.termType !== 'NamedNode') throw new Error(`RDF 1.2 predicates cannot be '${term.termType}'`);
    return term;
  }

  private static decodeObject(term: Quad_Object, encodings: ReadonlyMap<string, BasicEncoding>, active: Set<string>): Quad_Object {
    if (term.termType !== 'BlankNode') return term;
    const encoding = encodings.get(Rdf12JsonLdCodec.nodeKey(term));
    if (encoding === undefined) return term;
    const key = Rdf12JsonLdCodec.nodeKey(term);
    if (active.has(key)) throw new Error('RDF 1.2 Basic Encoding contains a cyclic triple term');
    active.add(key);
    const result = Rdf12JsonLdCodec.tripleFromEncoding(encoding, encodings, active);
    active.delete(key);
    return result;
  }

  private static decodeGraph(term: Quad['graph']): Quad['graph'] {
    if (term.termType === 'DefaultGraph' || term.termType === 'NamedNode' || term.termType === 'BlankNode') return term;
    throw new Error(`RDF 1.2 graph names cannot be '${term.termType}'`);
  }

  private static tripleFromEncoding(encoding: BasicEncoding, encodings: ReadonlyMap<string, BasicEncoding>, active: Set<string>): Quad {
    const subject = Rdf12JsonLdCodec.decodeComponent(encoding.subject.object, encodings, active);
    const predicate = Rdf12JsonLdCodec.decodeComponent(encoding.predicate.object, encodings, active);
    const object = Rdf12JsonLdCodec.decodeComponent(encoding.object.object, encodings, active);
    if (predicate.termType !== 'NamedNode') throw new Error('RDF 1.2 Basic Encoding has a non-named predicate component');
    const result = factory.quad(
      Rdf12JsonLdCodec.componentSubject(subject),
      predicate,
      Rdf12JsonLdCodec.componentObject(object),
    );
    if (!Rdf12JsonLdCodec.isQuad(result)) throw new Error('RDF 1.2 processor produced an invalid triple term');
    return result;
  }

  private static decodeComponent(term: Quad_Object, encodings: ReadonlyMap<string, BasicEncoding>, active: Set<string>): Quad_Object {
    return Rdf12JsonLdCodec.decodeObject(term, encodings, active);
  }

  private static componentSubject(term: Quad_Object): Quad_Subject {
    if (term.termType === 'NamedNode' || term.termType === 'BlankNode') return term;
    throw new Error(`RDF 1.2 triple-term subject component cannot be '${term.termType}'`);
  }

  private static componentObject(term: Quad_Object): Quad_Object {
    return term;
  }

  private static validateQuad(quad: Quad): void {
    if (quad.subject.termType === 'Variable') throw new Error('RDF 1.2 JSON-LD requires named-node or blank-node subjects');
    if (quad.predicate.termType !== 'NamedNode') throw new Error('RDF 1.2 JSON-LD requires named-node predicates');
  }

  private static toGraph(term: Quad['graph']): Quad['graph'] {
    if (term.termType === 'NamedNode') return factory.namedNode(term.value);
    if (term.termType === 'BlankNode') return factory.blankNode(term.value);
    if (term.termType === 'DefaultGraph') return factory.defaultGraph();
    throw new Error(`RDF 1.2 graph names cannot be '${term.termType}'`);
  }

  private static tripleKey(term: Extract<Term, { termType: 'Quad' }>, graph: Quad['graph']): string {
    return `${Rdf12JsonLdCodec.termKey(term.subject, graph)}|${Rdf12JsonLdCodec.termKey(term.predicate, graph)}|${Rdf12JsonLdCodec.termKey(term.object, graph)}`;
  }

  private static termKey(term: Term, graph: Quad['graph']): string {
    if (term.termType === 'Quad') return `Quad(${Rdf12JsonLdCodec.tripleKey(term, graph)})`;
    if (term.termType === 'Literal') return `Literal(${term.value}|${term.language}|${term.datatype.value})`;
    return `${term.termType}(${term.value})`;
  }

  private static quadKey(quad: Quad): string {
    return `${Rdf12JsonLdCodec.termKey(quad.subject, quad.graph)}|${Rdf12JsonLdCodec.termKey(quad.predicate, quad.graph)}|${Rdf12JsonLdCodec.termKey(quad.object, quad.graph)}|${Rdf12JsonLdCodec.termKey(quad.graph, quad.graph)}`;
  }

  private static nodeKey(term: Term): string {
    return `${term.termType}(${term.value})`;
  }

  private static isEncodingPredicate(term: Term): boolean {
    return term.termType === 'NamedNode' && [DagGraphTerms.RDF_TYPE, DagGraphTerms.RDF.ttSubject, DagGraphTerms.RDF.ttPredicate, DagGraphTerms.RDF.ttObject].some((value) => value === term.value);
  }

  private static sameTerm(left: Term, right: Term): boolean {
    return left.termType === right.termType && left.value === right.value;
  }

  private static isQuad(value: unknown): value is Quad {
    if (!Rdf12JsonLdCodec.isRecord(value)) return false;
    return Rdf12JsonLdCodec.isTerm(value['subject']) && Rdf12JsonLdCodec.isTerm(value['predicate'])
      && Rdf12JsonLdCodec.isTerm(value['object']) && Rdf12JsonLdCodec.isTerm(value['graph']);
  }

  private static isTerm(value: unknown): value is Term {
    return Rdf12JsonLdCodec.isRecord(value) && typeof value['termType'] === 'string' && typeof value['value'] === 'string';
  }

  private static isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
