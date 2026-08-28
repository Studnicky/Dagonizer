import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';

import { N3GraphDataset } from '@studnicky/dagonizer/adapter';
import type { GraphDatasetInterface, BindingType, QuadType, SlotPatternType, TermType } from '@studnicky/dagonizer/contracts';
import { DagGraphTerms, GraphDatasetRevision, GraphStateTerms, GraphStateTransferCodec } from '@studnicky/dagonizer/graph';

const JOURNAL_COMPACTION_BYTES = 1_048_576;

type JournalRecord =
  | { readonly operation: 'add'; readonly quads: readonly QuadType[] }
  | { readonly operation: 'delete'; readonly pattern: SlotPatternType }
  | { readonly operation: 'clearGraph'; readonly graph: TermType };

/** Durable graph adapter with append-only mutation journaling and atomic compaction. */
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
    this.#changed({ 'operation': 'add', 'quads': [{ 'subject': subject, predicate, 'object': object, 'graph': graph ?? DagGraphTerms.defaultGraph() }] });
  }

  select(pattern: SlotPatternType): readonly BindingType[] { return this.#dataset.select(pattern); }
  count(pattern: SlotPatternType): number { return this.#dataset.count(pattern); }

  clearGraph(graph: TermType): void {
    this.#dataset.clearGraph(graph);
    this.#changed({ 'operation': 'clearGraph', graph });
  }

  *triples(): IterableIterator<QuadType> { yield* this.#dataset.triples(); }

  delete(pattern: SlotPatternType): void {
    this.#dataset.delete(pattern);
    this.#changed({ 'operation': 'delete', pattern });
  }

  *match(pattern: SlotPatternType): IterableIterator<QuadType> { yield* this.#dataset.match(pattern); }
  ask(pattern: SlotPatternType): boolean { return this.#dataset.ask(pattern); }
  exportGraph(graph: TermType): IterableIterator<QuadType> { return this.#dataset.exportGraph(graph); }

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

  fork(): GraphDatasetInterface { return new N3GraphDataset(); }
  revision(): string { return this.#revisionCache ?? (this.#revisionCache = GraphDatasetRevision.of(this)); }

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
    try { mkdirSync(lockPath, { 'recursive': false }); } catch { throw new Error('Graph commit lock is held'); }
    try {
      const parent = this.#path.slice(0, this.#path.lastIndexOf('/'));
      if (parent.length > 0) mkdirSync(parent, { 'recursive': true });
      const diskDataset = new N3GraphDataset();
      if (existsSync(this.#path)) diskDataset.importGraph(GraphStateTransferCodec.decode(readFileSync(this.#path, 'utf8')));
      if (existsSync(this.#journalPath)) FileGraphDataset.#replayJournal(diskDataset, readFileSync(this.#journalPath, 'utf8'));
      if (diskDataset.revision() !== this.#committedRevision) throw new Error('Graph commit revision mismatch');
      this.#writeRevisionResource();
      const temporaryPath = `${this.#path}.${process.pid}.tmp`;
      writeFileSync(temporaryPath, GraphStateTransferCodec.encode(this.#dataset.triples()), 'utf8');
      renameSync(temporaryPath, this.#path);
      if (existsSync(this.#journalPath)) unlinkSync(this.#journalPath);
      this.#committedRevision = GraphDatasetRevision.of(this.#dataset);
      this.#revisionCache = this.#committedRevision;
      this.#dirty = false;
    } finally { rmdirSync(lockPath); }
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

  #appendJournal(record: JournalRecord): void { appendFileSync(this.#journalPath, `${JSON.stringify(record)}\n`, 'utf8'); }
  static #journalBytes(path: string): number { return existsSync(path) ? statSync(path).size : 0; }

  static #replayJournal(dataset: N3GraphDataset, journal: string): void {
    const lines = journal.trimEnd().split('\n');
    for (const [index, line] of lines.entries()) {
      if (line.length === 0) continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        if (index === lines.length - 1) return;
        throw new Error('Graph journal contains an invalid committed record');
      }
      const record = FileGraphDataset.#recordOf(value);
      if (record.operation === 'add') dataset.add(record.quads);
      else if (record.operation === 'delete') dataset.delete(record.pattern);
      else dataset.clearGraph(record.graph);
    }
  }

  static #recordOf(value: unknown): JournalRecord {
    if (!FileGraphDataset.#isJournalRecord(value)) throw new Error('Graph journal contains an invalid committed record');
    return value;
  }

  static #isJournalRecord(value: unknown): value is JournalRecord {
    if (!FileGraphDataset.#isObject(value)) return false;
    if (value['operation'] === 'add') return Array.isArray(value['quads']) && value['quads'].every(FileGraphDataset.#isQuad);
    if (value['operation'] === 'delete') return FileGraphDataset.#isSlotPattern(value['pattern']);
    if (value['operation'] === 'clearGraph') return FileGraphDataset.#isTerm(value['graph']);
    return false;
  }

  static #isQuad(value: unknown): value is QuadType {
    if (!FileGraphDataset.#isObject(value)) return false;
    return FileGraphDataset.#isTerm(value['subject'])
      && FileGraphDataset.#isTerm(value['predicate'])
      && FileGraphDataset.#isTerm(value['object'])
      && FileGraphDataset.#isTerm(value['graph']);
  }

  static #isSlotPattern(value: unknown): value is SlotPatternType {
    if (!FileGraphDataset.#isObject(value)) return false;
    for (const [key, slot] of Object.entries(value)) {
      if (key !== 'subject' && key !== 'predicate' && key !== 'object' && key !== 'graph') return false;
      if (typeof slot !== 'string' && !FileGraphDataset.#isTerm(slot)) return false;
    }
    return true;
  }

  static #isTerm(value: unknown): value is TermType {
    if (!FileGraphDataset.#isObject(value) || typeof value['value'] !== 'string') return false;
    if (value['termType'] === 'NamedNode') return true;
    if (value['termType'] === 'BlankNode' || value['termType'] === 'DefaultGraph' || value['termType'] === 'Variable') return true;
    if (value['termType'] === 'Literal') {
      const language = value['language'];
      const datatype = value['datatype'];
      return (language === undefined || typeof language === 'string')
        && (datatype === undefined || FileGraphDataset.#isNamedNode(datatype));
    }
    return value['termType'] === 'Quad' && value['value'] === '' && FileGraphDataset.#isQuad(value['quad']);
  }

  static #isNamedNode(value: unknown): boolean {
    return FileGraphDataset.#isObject(value) && value['termType'] === 'NamedNode' && typeof value['value'] === 'string';
  }

  static #isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
