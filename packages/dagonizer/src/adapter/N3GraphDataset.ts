import type * as RDF from '@rdfjs/types';
import { DataFactory, Store } from 'n3';
import type { BaseQuad } from 'n3';

import type { GraphDatasetInterface } from '../contracts/GraphDatasetInterface.js';
import type { BindingType, QuadType, SlotPatternType, TermType } from '../contracts/TripleStoreInterface.js';
import { DagGraphTerms } from '../graph/DagGraphTerms.js';
import { GraphDatasetRevision } from '../graph/GraphDatasetRevision.js';

type UndoOperation =
  | { readonly operation: 'add'; readonly quads: readonly QuadType[] }
  | { readonly operation: 'delete'; readonly quads: readonly QuadType[] };

/** Browser-compatible N3 adapter implementing the canonical graph dataset port. */
export class N3GraphDataset implements GraphDatasetInterface {
  readonly #store: Store<RDF.Quad, BaseQuad, RDF.Quad, RDF.Quad>;
  readonly #undoLog: UndoOperation[] = [];
  #transactionDepth = 0;
  #replayingUndo = false;
  #revisionCache: string | undefined;

  constructor() {
    this.#store = new Store<RDF.Quad, BaseQuad, RDF.Quad, RDF.Quad>();
  }

  add(quads: Iterable<QuadType>): void {
    this.#revisionCache = undefined;
    const materialized = [...quads];
    const added = materialized.filter((quad) => !this.#store.has(N3GraphDataset.rdfQuad(quad)));
    this.#store.addQuads(materialized.map((quad) => N3GraphDataset.rdfQuad(quad)));
    this.#recordUndo({ 'operation': 'delete', 'quads': added });
  }

  assert(subject: TermType, predicate: TermType, object: TermType, graph?: TermType): void {
    this.#revisionCache = undefined;
    const quad = DataFactory.quad(
      N3GraphDataset.toSubject(subject),
      N3GraphDataset.toPredicate(predicate),
      N3GraphDataset.toObject(object),
      graph === undefined ? DataFactory.defaultGraph() : N3GraphDataset.toGraph(graph),
    );
    if (this.#store.has(quad)) return;
    this.#store.addQuad(quad);
    this.#recordUndo({ 'operation': 'delete', 'quads': [N3GraphDataset.quadOf(quad)] });
  }

  select(pattern: SlotPatternType): readonly BindingType[] {
    const bindings: BindingType[] = [];
    for (const quad of this.match(pattern)) {
      const binding: BindingType = {};
      N3GraphDataset.bind(binding, pattern.subject, quad.subject);
      N3GraphDataset.bind(binding, pattern.predicate, quad.predicate);
      N3GraphDataset.bind(binding, pattern.object, quad.object);
      N3GraphDataset.bind(binding, pattern.graph, quad.graph);
      bindings.push(binding);
    }
    return bindings;
  }

  count(pattern: SlotPatternType): number {
    if (![pattern.subject, pattern.predicate, pattern.object, pattern.graph].some((slot) => typeof slot === 'string')) {
      return this.#store.countQuads(
        N3GraphDataset.countSlot(pattern.subject),
        N3GraphDataset.countSlot(pattern.predicate),
        N3GraphDataset.countSlot(pattern.object),
        N3GraphDataset.countSlot(pattern.graph),
      );
    }
    return [...this.match(pattern)].length;
  }

  clearGraph(graph: TermType): void {
    this.#revisionCache = undefined;
    const removed = [...this.match({ graph })];
    this.#store.deleteGraph(N3GraphDataset.toGraph(graph));
    this.#recordUndo({ 'operation': 'add', 'quads': removed });
  }

  *triples(): IterableIterator<QuadType> {
    for (const quad of this.#store.getQuads(null, null, null, null)) yield N3GraphDataset.quadOf(quad);
  }

  delete(pattern: SlotPatternType): void {
    this.#revisionCache = undefined;
    const removed = [...this.match(pattern)];
    this.#store.deleteMatches(
      N3GraphDataset.deleteSlot(pattern.subject),
      N3GraphDataset.deleteSlot(pattern.predicate),
      N3GraphDataset.deleteSlot(pattern.object),
      N3GraphDataset.deleteSlot(pattern.graph),
    );
    this.#recordUndo({ 'operation': 'add', 'quads': removed });
  }

  *match(pattern: SlotPatternType): IterableIterator<QuadType> {
    const quads = this.#store.getQuads(
      N3GraphDataset.slot(pattern.subject),
      N3GraphDataset.slot(pattern.predicate),
      N3GraphDataset.slot(pattern.object),
      N3GraphDataset.slot(pattern.graph),
    );
    for (const quad of quads) yield N3GraphDataset.quadOf(quad);
  }

  ask(pattern: SlotPatternType): boolean {
    return this.match(pattern).next().done !== true;
  }

  exportGraph(graph: TermType): IterableIterator<QuadType> {
    return this.match({ graph });
  }

  importGraph(quads: Iterable<QuadType>): void {
    this.add(quads);
  }

  async importGraphAsync(quads: AsyncIterable<QuadType>): Promise<void> {
    this.#revisionCache = undefined;
    const materialized: QuadType[] = [];
    for await (const quad of quads) materialized.push(quad);
    this.add(materialized);
  }

  fork(): GraphDatasetInterface {
    return new N3GraphDataset();
  }

  revision(): string {
    if (this.#revisionCache === undefined) this.#revisionCache = GraphDatasetRevision.of(this);
    return this.#revisionCache;
  }

  transactAtRevision<T>(expectedRevision: string, operation: (dataset: GraphDatasetInterface) => T): T {
    if (this.revision() !== expectedRevision) throw new Error('Graph transaction revision mismatch');
    return this.transact(operation);
  }

  transact<T>(operation: (dataset: GraphDatasetInterface) => T): T {
    const start = this.#undoLog.length;
    this.#transactionDepth += 1;
    try {
      return operation(this);
    } catch (error) {
      this.#rollback(start);
      throw error;
    } finally {
      this.#transactionDepth -= 1;
      if (this.#transactionDepth === 0) this.#undoLog.length = 0;
    }
  }

  async transactAsync<T>(operation: (dataset: GraphDatasetInterface) => Promise<T>): Promise<T> {
    const start = this.#undoLog.length;
    this.#transactionDepth += 1;
    try {
      return await operation(this);
    } catch (error) {
      this.#rollback(start);
      throw error;
    } finally {
      this.#transactionDepth -= 1;
      if (this.#transactionDepth === 0) this.#undoLog.length = 0;
    }
  }

  #recordUndo(operation: UndoOperation): void {
    if (this.#transactionDepth !== 0 && !this.#replayingUndo && operation.quads.length !== 0) this.#undoLog.push(operation);
  }

  #rollback(start: number): void {
    this.#replayingUndo = true;
    try {
      for (let index = this.#undoLog.length - 1; index >= start; index -= 1) {
        const operation = this.#undoLog[index];
        if (operation === undefined) continue;
        if (operation.operation === 'add') this.#store.addQuads(operation.quads.map((quad) => N3GraphDataset.rdfQuad(quad)));
        else for (const quad of operation.quads) this.#store.delete(N3GraphDataset.rdfQuad(quad));
      }
      this.#undoLog.length = start;
      this.#revisionCache = undefined;
    } finally {
      this.#replayingUndo = false;
    }
  }

  private static slot(value: TermType | string | undefined): RDF.Term | string | null {
    return typeof value === 'string' || value === undefined ? null : N3GraphDataset.toTerm(value);
  }

  private static deleteSlot(value: TermType | string | undefined): RDF.Term | undefined {
    return typeof value === 'string' || value === undefined ? undefined : N3GraphDataset.toTerm(value);
  }

  private static countSlot(value: TermType | string | undefined): RDF.Term | null {
    if (value === undefined) return null;
    if (typeof value === 'string') throw new Error('N3 count slot cannot be a variable');
    return N3GraphDataset.toTerm(value);
  }

  private static bind(binding: BindingType, pattern: TermType | string | undefined, value: TermType): void {
    if (typeof pattern === 'string' && pattern.startsWith('?')) binding[pattern.slice(1)] = value;
  }

  private static rdfQuad(quad: QuadType): RDF.Quad {
    return DataFactory.quad(
      N3GraphDataset.toSubject(quad.subject),
      N3GraphDataset.toPredicate(quad.predicate),
      N3GraphDataset.toObject(quad.object),
      N3GraphDataset.toGraph(quad.graph),
    );
  }

  private static toTerm(term: TermType): RDF.Term {
    if (term.termType === 'Quad') return N3GraphDataset.rdfQuad(term.quad);
    if (term.termType === 'NamedNode') return DataFactory.namedNode(term.value);
    if (term.termType === 'BlankNode') return DataFactory.blankNode(term.value);
    if (term.termType === 'Variable') return DataFactory.variable(term.value);
    if (term.termType === 'DefaultGraph') return DataFactory.defaultGraph();
    if (term.termType === 'Literal') {
      if (term.language !== undefined) return DataFactory.literal(term.value, term.language);
      return DataFactory.literal(term.value, term.datatype === undefined ? undefined : DataFactory.namedNode(term.datatype.value));
    }
    throw new Error(`Invalid RDF term '${term.termType}'`);
  }

  private static toSubject(term: TermType): RDF.Quad_Subject {
    if (term.termType === 'NamedNode') return DataFactory.namedNode(term.value);
    if (term.termType === 'BlankNode') return DataFactory.blankNode(term.value);
    if (term.termType === 'Variable') return DataFactory.variable(term.value);
    throw new Error(`Invalid RDF subject term '${term.termType}'`);
  }

  private static toPredicate(term: TermType): RDF.Quad_Predicate {
    if (term.termType === 'NamedNode') return DataFactory.namedNode(term.value);
    if (term.termType === 'Variable') return DataFactory.variable(term.value);
    throw new Error(`Invalid RDF predicate term '${term.termType}'`);
  }

  private static toObject(term: TermType): RDF.Quad_Object {
    if (term.termType === 'Quad') return N3GraphDataset.rdfQuad(term.quad);
    if (term.termType === 'NamedNode') return DataFactory.namedNode(term.value);
    if (term.termType === 'BlankNode') return DataFactory.blankNode(term.value);
    if (term.termType === 'Variable') return DataFactory.variable(term.value);
    if (term.termType === 'DefaultGraph') throw new Error('Invalid RDF object term DefaultGraph');
    if (term.termType === 'Literal') {
      if (term.language !== undefined) return DataFactory.literal(term.value, term.language);
      return DataFactory.literal(term.value, term.datatype === undefined ? undefined : DataFactory.namedNode(term.datatype.value));
    }
    throw new Error(`Invalid RDF object term '${term.termType}'`);
  }

  private static toGraph(term: TermType): RDF.Quad_Graph {
    if (term.termType === 'NamedNode') return DataFactory.namedNode(term.value);
    if (term.termType === 'BlankNode') return DataFactory.blankNode(term.value);
    if (term.termType === 'Variable') return DataFactory.variable(term.value);
    if (term.termType === 'DefaultGraph') return DataFactory.defaultGraph();
    throw new Error(`Invalid RDF graph term '${term.termType}'`);
  }

  private static quadOf(quad: RDF.BaseQuad): QuadType {
    return {
      "subject": N3GraphDataset.termOf(quad.subject),
      "predicate": N3GraphDataset.termOf(quad.predicate),
      "object": N3GraphDataset.termOf(quad.object),
      "graph": N3GraphDataset.termOf(quad.graph),
    };
  }

  private static termOf(term: RDF.Term): TermType {
    if (term.termType === 'Quad') return { "termType": 'Quad', "value": '', "quad": N3GraphDataset.quadOf(term) };
    if (term.termType === 'Literal') {
      if (term.language.length > 0) return { "termType": 'Literal', "value": term.value, "language": term.language };
      if (term.datatype.value !== DagGraphTerms.XSD_STRING) return { "termType": 'Literal', "value": term.value, "datatype": { "termType": 'NamedNode', "value": term.datatype.value } };
      return { "termType": 'Literal', "value": term.value };
    }
    return { "termType": term.termType, "value": term.value };
  }
}
