import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';

import type { GraphDatasetInterface } from '../contracts/GraphDatasetInterface.js';
import type { BindingType, QuadType, SlotPatternType, TermType } from '../contracts/TripleStoreInterface.js';
import { DagGraphTerms } from '../graph/DagGraphTerms.js';
import { GraphDatasetRevision } from '../graph/GraphDatasetRevision.js';
import { GraphStateTerms } from '../graph/GraphStateTerms.js';
import { GraphStateTransferCodec } from '../graph/GraphStateTransferCodec.js';

import { N3GraphDataset } from './N3GraphDataset.js';

/** Node durable adapter that atomically persists the shared graph port as N-Quads. */
export class FileGraphDataset implements GraphDatasetInterface {
  readonly #path: string;
  readonly #dataset: N3GraphDataset;
  #transactionDepth = 0;
  #dirty = false;
  #committedRevision: string;

  constructor(path: string) {
    this.#path = path;
    this.#dataset = new N3GraphDataset();
    if (existsSync(path)) this.#dataset.importGraph(GraphStateTransferCodec.decode(readFileSync(path, 'utf8')));
    this.#committedRevision = GraphDatasetRevision.of(this.#dataset);
  }

  add(quads: Iterable<QuadType>): void {
    this.#dataset.add(quads);
    this.#changed();
  }

  assert(subject: TermType, predicate: TermType, object: TermType, graph?: TermType): void {
    this.#dataset.assert(subject, predicate, object, graph);
    this.#changed();
  }

  select(pattern: SlotPatternType): readonly BindingType[] {
    return this.#dataset.select(pattern);
  }

  count(pattern: SlotPatternType): number {
    return this.#dataset.count(pattern);
  }

  clearGraph(graph: TermType): void {
    this.#dataset.clearGraph(graph);
    this.#changed();
  }

  *triples(): IterableIterator<QuadType> {
    yield* this.#dataset.triples();
  }

  delete(pattern: SlotPatternType): void {
    this.#dataset.delete(pattern);
    this.#changed();
  }

  *match(pattern: SlotPatternType): IterableIterator<QuadType> {
    yield* this.#dataset.match(pattern);
  }

  ask(pattern: SlotPatternType): boolean {
    return this.#dataset.ask(pattern);
  }

  exportGraph(graph: TermType): IterableIterator<QuadType> {
    return this.#dataset.exportGraph(graph);
  }

  importGraph(quads: Iterable<QuadType>): void {
    this.#dataset.importGraph(quads);
    this.#changed();
  }

  async importGraphAsync(quads: AsyncIterable<QuadType>): Promise<void> {
    await this.#dataset.importGraphAsync(quads);
    this.#changed();
  }

  fork(): GraphDatasetInterface {
    // A clone receives its state snapshot after the fork. Do not copy the
    // parent's durable run graph into the child dataset.
    return new N3GraphDataset();
  }

  revision(): string {
    return GraphDatasetRevision.of(this);
  }

  transactAtRevision<T>(expectedRevision: string, operation: (dataset: GraphDatasetInterface) => T): T {
    if (this.revision() !== expectedRevision) throw new Error('Graph transaction revision mismatch');
    return this.transact(operation);
  }

  transact<T>(operation: (dataset: GraphDatasetInterface) => T): T {
    const snapshot = [...this.#dataset.triples()];
    const dirty = this.#dirty;
    this.#transactionDepth += 1;
    try {
      const result = operation(this);
      return result;
    } catch (error) {
      this.#restore(snapshot, dirty);
      throw error;
    } finally {
      this.#transactionDepth -= 1;
      if (this.#transactionDepth === 0 && this.#dirty) this.flush();
    }
  }

  async transactAsync<T>(operation: (dataset: GraphDatasetInterface) => Promise<T>): Promise<T> {
    const snapshot = [...this.#dataset.triples()];
    const dirty = this.#dirty;
    this.#transactionDepth += 1;
    try {
      return await operation(this);
    } catch (error) {
      this.#restore(snapshot, dirty);
      throw error;
    } finally {
      this.#transactionDepth -= 1;
      if (this.#transactionDepth === 0 && this.#dirty) this.flush();
    }
  }

  flush(): void {
    const lockPath = `${this.#path}.lock`;
    try {
      mkdirSync(lockPath);
    } catch {
      throw new Error('Graph commit lock is held');
    }
    try {
      const diskRevision = existsSync(this.#path)
        ? GraphDatasetRevision.ofQuads(GraphStateTransferCodec.decode(readFileSync(this.#path, 'utf8')))
        : GraphDatasetRevision.ofQuads([]);
      if (diskRevision !== this.#committedRevision) throw new Error('Graph commit revision mismatch');
      this.#writeRevisionResource();
      const temporaryPath = `${this.#path}.${process.pid}.tmp`;
      writeFileSync(temporaryPath, GraphStateTransferCodec.encode(this.#dataset.triples()), 'utf8');
      renameSync(temporaryPath, this.#path);
      this.#committedRevision = GraphDatasetRevision.of(this.#dataset);
      this.#dirty = false;
    } finally {
      rmdirSync(lockPath);
    }
  }

  #changed(): void {
    this.#dirty = true;
    if (this.#transactionDepth === 0) this.flush();
  }

  #restore(quads: readonly QuadType[], dirty: boolean): void {
    this.#dataset.delete({});
    this.#dataset.add(quads);
    this.#dirty = dirty;
  }

  #writeRevisionResource(): void {
    const revision = GraphDatasetRevision.of(this.#dataset);
    const graph = DagGraphTerms.namedNode(GraphStateTerms.revisionGraphIri());
    const resource = DagGraphTerms.namedNode(GraphStateTerms.revisionIri(revision));
    const dataset = DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.Dataset);
    this.#dataset.clearGraph(graph);
    this.#dataset.add([
      { 'subject': resource, 'predicate': DagGraphTerms.namedNode(DagGraphTerms.RDF_TYPE), 'object': DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.Revision), graph },
      { 'subject': resource, 'predicate': DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.RevisionValue), 'object': DagGraphTerms.literal(revision), graph },
      { 'subject': resource, 'predicate': DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.RevisionOf), 'object': dataset, graph },
      { 'subject': resource, 'predicate': DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.GeneratedAt), 'object': DagGraphTerms.literal(new Date().toISOString(), GraphStateTerms.XSD.dateTime), graph },
    ]);
  }
}
