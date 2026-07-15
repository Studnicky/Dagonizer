import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';

import type { GraphDatasetInterface } from '../contracts/GraphDatasetInterface.js';
import type { BindingType, QuadType, SlotPatternType, TermType } from '../contracts/TripleStoreInterface.js';
import { DagGraphTerms } from '../graph/DagGraphTerms.js';
import { GraphDatasetRevision } from '../graph/GraphDatasetRevision.js';
import { GraphStateTerms } from '../graph/GraphStateTerms.js';
import { GraphStateTransferCodec } from '../graph/GraphStateTransferCodec.js';

import { N3GraphDataset } from './N3GraphDataset.js';

const JOURNAL_COMPACTION_BYTES = 1_048_576;

type JournalRecord =
  | { readonly operation: 'add'; readonly quads: readonly QuadType[] }
  | { readonly operation: 'delete'; readonly pattern: SlotPatternType }
  | { readonly operation: 'clearGraph'; readonly graph: TermType };

/** Durable graph adapter with append-only mutation journaling and atomic N-Quads compaction. */
export class FileGraphDataset implements GraphDatasetInterface {
  readonly #path: string;
  readonly #journalPath: string;
  readonly #dataset: N3GraphDataset;
  #transactionDepth = 0;
  #dirty = false;
  #committedRevision: string;
  #revisionCache: string | undefined;

  constructor(path: string) {
    this.#path = path;
    this.#journalPath = `${path}.journal`;
    this.#dataset = new N3GraphDataset();
    if (existsSync(path)) this.#dataset.importGraph(GraphStateTransferCodec.decode(readFileSync(path, 'utf8')));
    if (existsSync(this.#journalPath)) FileGraphDataset.#replayJournal(this.#dataset, readFileSync(this.#journalPath, 'utf8'));
    this.#committedRevision = GraphDatasetRevision.of(this.#dataset);
    this.#revisionCache = this.#committedRevision;
  }

  add(quads: Iterable<QuadType>): void {
    const materialized = [...quads];
    this.#dataset.add(materialized);
    this.#changed({ 'operation': 'add', 'quads': materialized });
  }

  assert(subject: TermType, predicate: TermType, object: TermType, graph?: TermType): void {
    this.#dataset.assert(subject, predicate, object, graph);
    this.#changed({
      'operation': 'add',
      'quads': [{ 'subject': subject, predicate, 'object': object, 'graph': graph ?? DagGraphTerms.defaultGraph() }],
    });
  }

  select(pattern: SlotPatternType): readonly BindingType[] {
    return this.#dataset.select(pattern);
  }

  count(pattern: SlotPatternType): number {
    return this.#dataset.count(pattern);
  }

  clearGraph(graph: TermType): void {
    this.#dataset.clearGraph(graph);
    this.#changed({ 'operation': 'clearGraph', graph });
  }

  *triples(): IterableIterator<QuadType> {
    yield* this.#dataset.triples();
  }

  delete(pattern: SlotPatternType): void {
    this.#dataset.delete(pattern);
    this.#changed({ 'operation': 'delete', pattern });
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
    const materialized = [...quads];
    this.#dataset.importGraph(materialized);
    this.#changed({ 'operation': 'add', 'quads': materialized });
  }

  async importGraphAsync(quads: AsyncIterable<QuadType>): Promise<void> {
    const materialized: QuadType[] = [];
    for await (const quad of quads) materialized.push(quad);
    this.#dataset.importGraph(materialized);
    this.#changed({ 'operation': 'add', 'quads': materialized });
  }

  fork(): GraphDatasetInterface {
    // A clone receives its state snapshot after the fork. Do not copy the
    // parent's durable run graph into the child dataset.
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
    const dirty = this.#dirty;
    try {
      return this.#dataset.transact(() => {
        this.#transactionDepth += 1;
        let succeeded = false;
        try {
          const result = operation(this);
          succeeded = true;
          return result;
        } finally {
          this.#transactionDepth -= 1;
          if (succeeded && this.#transactionDepth === 0 && this.#dirty) this.flush();
        }
      });
    } catch (error) {
      this.#dirty = dirty;
      throw error;
    }
  }

  async transactAsync<T>(operation: (dataset: GraphDatasetInterface) => Promise<T>): Promise<T> {
    const dirty = this.#dirty;
    try {
      return await this.#dataset.transactAsync(async () => {
        this.#transactionDepth += 1;
        let succeeded = false;
        try {
          const result = await operation(this);
          succeeded = true;
          return result;
        } finally {
          this.#transactionDepth -= 1;
          if (succeeded && this.#transactionDepth === 0 && this.#dirty) this.flush();
        }
      });
    } catch (error) {
      this.#dirty = dirty;
      throw error;
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
      const diskDataset = new N3GraphDataset();
      if (existsSync(this.#path)) diskDataset.importGraph(GraphStateTransferCodec.decode(readFileSync(this.#path, 'utf8')));
      if (existsSync(this.#journalPath)) FileGraphDataset.#replayJournal(diskDataset, readFileSync(this.#journalPath, 'utf8'));
      const diskRevision = diskDataset.revision();
      if (diskRevision !== this.#committedRevision) throw new Error('Graph commit revision mismatch');
      this.#writeRevisionResource();
      const temporaryPath = `${this.#path}.${process.pid}.tmp`;
      writeFileSync(temporaryPath, GraphStateTransferCodec.encode(this.#dataset.triples()), 'utf8');
      renameSync(temporaryPath, this.#path);
      if (existsSync(this.#journalPath)) unlinkSync(this.#journalPath);
      this.#committedRevision = GraphDatasetRevision.of(this.#dataset);
      this.#revisionCache = this.#committedRevision;
      this.#dirty = false;
    } finally {
      rmdirSync(lockPath);
    }
  }

  #changed(record: JournalRecord): void {
    this.#revisionCache = undefined;
    this.#dirty = true;
    if (this.#transactionDepth !== 0) return;
    this.#appendJournal(record);
    const revisionFacts = this.#writeRevisionResource();
    this.#appendJournal({ 'operation': 'clearGraph', 'graph': DagGraphTerms.namedNode(GraphStateTerms.revisionGraphIri()) });
    this.#appendJournal({ 'operation': 'add', 'quads': revisionFacts });
    this.#committedRevision = GraphDatasetRevision.of(this.#dataset);
    this.#revisionCache = this.#committedRevision;
    this.#dirty = false;
    if (FileGraphDataset.#journalBytes(this.#journalPath) >= JOURNAL_COMPACTION_BYTES) this.flush();
  }

  #writeRevisionResource(): QuadType[] {
    const revision = GraphDatasetRevision.of(this.#dataset);
    const graph = DagGraphTerms.namedNode(GraphStateTerms.revisionGraphIri());
    const resource = DagGraphTerms.namedNode(GraphStateTerms.revisionIri(revision));
    const dataset = DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.Dataset);
    this.#dataset.clearGraph(graph);
    const facts = [
      { 'subject': resource, 'predicate': DagGraphTerms.namedNode(DagGraphTerms.RDF_TYPE), 'object': DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.Revision), graph },
      { 'subject': resource, 'predicate': DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.RevisionValue), 'object': DagGraphTerms.literal(revision), graph },
      { 'subject': resource, 'predicate': DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.RevisionOf), 'object': dataset, graph },
      { 'subject': resource, 'predicate': DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.GeneratedAt), 'object': DagGraphTerms.literal(new Date().toISOString(), GraphStateTerms.XSD.dateTime), graph },
    ];
    this.#dataset.add(facts);
    return facts;
  }

  #appendJournal(record: JournalRecord): void {
    appendFileSync(this.#journalPath, `${JSON.stringify(record)}\n`, 'utf8');
  }

  static #journalBytes(path: string): number {
    return existsSync(path) ? statSync(path).size : 0;
  }

  static #replayJournal(dataset: N3GraphDataset, journal: string): void {
    for (const line of journal.split('\n')) {
      if (line.length === 0) continue;
      const record: JournalRecord = JSON.parse(line);
      if (record.operation === 'add') dataset.add(record.quads);
      else if (record.operation === 'delete') dataset.delete(record.pattern);
      else dataset.clearGraph(record.graph);
    }
  }
}
