import { N3GraphDataset } from '../adapter/N3GraphDataset.js';
import type { AbortableOptionsType } from '../contracts/AbortableOptionsType.js';
import type { GraphDatasetInterface } from '../contracts/GraphDatasetInterface.js';
import type { GraphJournalStoreInterface } from '../contracts/GraphJournalStore.js';
import type { BindingType, QuadType, SlotPatternType, TermType } from '../contracts/TripleStoreInterface.js';

import { GraphSkolemizer } from './GraphSkolemizer.js';
import { GraphStateTransferCodec } from './GraphStateTransferCodec.js';

/** Number of appended deltas between automatic snapshot compactions. */
const COMPACTION_THRESHOLD = 200;

/** Synchronous N3 working set with asynchronous write-behind graph durability. */
export class PersistentGraphDataset implements GraphDatasetInterface {
  readonly #runIri: string;
  readonly #journal: GraphJournalStoreInterface;
  readonly #working: GraphDatasetInterface;
  #mutationDepth = 0;
  #seq: number;
  #deltasSinceCompaction = 0;
  #pending: Promise<void> = Promise.resolve();
  #degradedError: Error | undefined;

  constructor(runIri: string, journal: GraphJournalStoreInterface, working: GraphDatasetInterface = new N3GraphDataset(), initialSeq = 0) {
    this.#runIri = runIri;
    this.#journal = journal;
    this.#working = working;
    this.#seq = initialSeq;
  }

  /** Reconstruct a dataset from the journal's snapshot base plus its trailing delta log. */
  static async reopen(runIri: string, journal: GraphJournalStoreInterface): Promise<PersistentGraphDataset> {
    const working = new N3GraphDataset();
    const snapshotChunks: string[] = [];
    for await (const chunk of journal.readSnapshot(runIri)) snapshotChunks.push(chunk);
    const snapshotText = snapshotChunks.join('');
    if (snapshotText.length > 0) working.importGraph(GraphSkolemizer.deskolemize(GraphStateTransferCodec.decode(snapshotText), runIri));

    let seq = 0;
    for await (const record of journal.readLog(runIri)) {
      const additions = GraphSkolemizer.deskolemize(GraphStateTransferCodec.decode(record.additions), runIri);
      const deletions = GraphSkolemizer.deskolemize(GraphStateTransferCodec.decode(record.deletions), runIri);
      working.transact((transaction) => {
        for (const quad of deletions) transaction.delete(PersistentGraphDataset.#exactPattern(quad));
        transaction.importGraph(additions);
      });
      seq = record.seq;
    }
    return new PersistentGraphDataset(runIri, journal, working, seq);
  }

  assert(subject: TermType, predicate: TermType, object: TermType, graph?: TermType): void {
    this.#mutate(() => this.#working.assert(subject, predicate, object, graph));
  }

  add(quads: Iterable<QuadType>, _options?: AbortableOptionsType): void {
    this.#mutate(() => this.#working.add(quads));
  }

  ask(pattern: SlotPatternType, _options?: AbortableOptionsType): boolean { return this.#working.ask(pattern); }
  select(pattern: SlotPatternType): readonly BindingType[] { return this.#working.select(pattern); }
  count(pattern: SlotPatternType, _options?: AbortableOptionsType): number { return this.#working.count(pattern); }
  clearGraph(graph: TermType, _options?: AbortableOptionsType): void { this.#mutate(() => this.#working.clearGraph(graph)); }
  *triples(): IterableIterator<QuadType> { yield* this.#working.triples(); }
  *match(pattern: SlotPatternType, _options?: AbortableOptionsType): IterableIterator<QuadType> { yield* this.#working.match(pattern); }
  exportGraph(graph: TermType, _options?: AbortableOptionsType): IterableIterator<QuadType> { return this.#working.exportGraph(graph); }

  delete(pattern: SlotPatternType, _options?: AbortableOptionsType): void { this.#mutate(() => this.#working.delete(pattern)); }
  importGraph(quads: Iterable<QuadType>, _options?: AbortableOptionsType): void { this.#mutate(() => this.#working.importGraph(quads)); }
  async importGraphAsync(quads: AsyncIterable<QuadType>, _options?: AbortableOptionsType): Promise<void> {
    const materialized: QuadType[] = [];
    for await (const quad of quads) materialized.push(quad);
    this.importGraph(materialized);
  }

  fork(): GraphDatasetInterface { return this.#working.fork(); }
  revision(): string { return this.#working.revision(); }
  transactAtRevision<T>(expectedRevision: string, operation: (dataset: GraphDatasetInterface) => T, _options?: AbortableOptionsType): T {
    return this.#transaction(() => this.#working.transact(() => operation(this)), expectedRevision);
  }
  transact<T>(operation: (dataset: GraphDatasetInterface) => T, _options?: AbortableOptionsType): T {
    return this.#transaction(() => this.#working.transact(() => operation(this)));
  }
  async transactAsync<T>(operation: (dataset: GraphDatasetInterface) => Promise<T>, _options?: AbortableOptionsType): Promise<T> {
    const before = this.#snapshot();
    this.#mutationDepth += 1;
    try {
      return await this.#working.transactAsync(() => operation(this));
    } finally {
      this.#mutationDepth -= 1;
      if (this.#mutationDepth === 0) this.#enqueueDelta(before);
    }
  }

  /** Wait until all queued write-behind journal operations have settled; rethrows a degraded journal's error. */
  async flush(): Promise<void> {
    await this.#pending.catch(() => { /* real error surfaces below via #degradedError */ });
    if (this.#degradedError !== undefined) throw this.#degradedError;
  }

  /** Snapshot the current working set and drop the journal's log through the current sequence. */
  async compact(): Promise<void> {
    const throughSeq = this.#seq;
    await this.#enqueue(async () => {
      await this.#compactLocked(throughSeq);
      this.#deltasSinceCompaction = 0;
    });
  }

  #mutate(operation: () => void): void {
    const before = this.#mutationDepth === 0 ? this.#snapshot() : undefined;
    operation();
    if (before !== undefined) this.#enqueueDelta(before);
  }

  #transaction<T>(operation: () => T, expectedRevision?: string): T {
    if (expectedRevision !== undefined && this.revision() !== expectedRevision) throw new Error('Graph transaction revision mismatch');
    const before = this.#snapshot();
    this.#mutationDepth += 1;
    try {
      return operation();
    } finally {
      this.#mutationDepth -= 1;
      if (this.#mutationDepth === 0) this.#enqueueDelta(before);
    }
  }

  #snapshot(): Map<string, QuadType> {
    const snapshot = new Map<string, QuadType>();
    for (const quad of this.#working.triples()) snapshot.set(GraphStateTransferCodec.encode([quad]), quad);
    return snapshot;
  }

  #enqueueDelta(before: Map<string, QuadType>): void {
    const after = this.#snapshot();
    const additions: QuadType[] = [];
    const deletions: QuadType[] = [];
    for (const [key, quad] of after) if (!before.has(key)) additions.push(quad);
    for (const [key, quad] of before) if (!after.has(key)) deletions.push(quad);
    if (additions.length === 0 && deletions.length === 0) return;

    const seq = ++this.#seq;
    const record = {
      seq,
      "additions": GraphStateTransferCodec.encode(GraphSkolemizer.skolemize(additions, this.#runIri)),
      "deletions": GraphStateTransferCodec.encode(GraphSkolemizer.skolemize(deletions, this.#runIri)),
    };
    void this.#enqueue(async () => {
      await this.#journal.append(this.#runIri, record);
      this.#deltasSinceCompaction += 1;
      if (this.#deltasSinceCompaction >= COMPACTION_THRESHOLD) {
        await this.#compactLocked(seq);
        this.#deltasSinceCompaction = 0;
      }
    });
  }

  /** Serialize `task` behind every prior queued operation; the first failure sticks as a terminal degraded error. */
  #enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.#pending
      .catch(() => { /* a prior op already recorded its failure in #degradedError; keep the chain moving */ })
      .then(async () => {
        if (this.#degradedError !== undefined) throw this.#degradedError;
        try {
          await task();
        } catch (error) {
          this.#degradedError = error instanceof Error ? error : new Error(String(error));
          throw this.#degradedError;
        }
      });
    this.#pending = next;
    next.catch(() => { /* terminal handler: real errors surface via flush()/compact() awaiters, never as an unhandled rejection */ });
    return next;
  }

  async #compactLocked(throughSeq: number): Promise<void> {
    const snapshot = GraphSkolemizer.skolemize([...this.#working.triples()], this.#runIri);
    const nquads = GraphStateTransferCodec.encode(snapshot);
    await this.#journal.compact(this.#runIri, PersistentGraphDataset.#singleChunk(nquads), throughSeq);
  }

  static async *#singleChunk(text: string): AsyncIterable<string> {
    yield text;
  }

  static #exactPattern(quad: QuadType): SlotPatternType {
    return { "subject": quad.subject, "predicate": quad.predicate, "object": quad.object, "graph": quad.graph };
  }
}
