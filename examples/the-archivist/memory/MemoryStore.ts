/**
 * MemoryStore: browser-runnable RDF quad store for the Archivist.
 *
 * Wraps `n3.Store` (pure JS, ~30KB gzipped, identical surface on Node
 * and in the browser) and exposes a named-graph-aware surface:
 *
 *   assert(s, p, o, graph?)              write one quad
 *   ask({ s?, p?, o?, graph? })          boolean existence check
 *   select({ s?, p?, o?, graph? })       list bound rows (vars start with ?)
 *   triplesIn(graph)                     iterate quads in one graph
 *   triples()                            iterate every quad
 *
 * Four named graphs are reserved by convention:
 *
 *   urn:dagonizer:ontology              TBox schema (classes, properties, domains, ranges);
 *                                          loaded once on mount via loadOntology()
 *   urn:dagonizer:memory                persistent cross-run facts
 *                                          (books, sources, scores; survives reloads)
 *   urn:dagonizer:state:<runId>         per-run typed-state mirror
 *                                          (ArchivistState fields → triples on every node end)
 *   urn:dagonizer:prov:<runId>          PROV-O activity log
 *                                          (which node did what when, attributed to which agent)
 *
 * Pattern surface intentionally mirrors SPARQL's basic graph pattern
 * (`{ ?s <pred> ?o }`) without a full SPARQL engine. For richer query
 * shapes (UNION, FILTER, paths) swap in `@comunica/query-sparql`.
 */

import { DataFactory, Parser, Store, Writer } from 'n3';
import type { Literal, NamedNode, Quad, Quad_Graph, Quad_Object, Quad_Predicate, Quad_Subject, Term } from 'n3';

import type { SnapshottableInterface, StoreSnapshotType } from '@studnicky/dagonizer/contracts';

const { namedNode, literal, quad, defaultGraph } = DataFactory;

const LOCALSTORAGE_KEY = 'dagonizer-archivist-memory';

/** Stable identifier + version for `MemoryStore` snapshots; resume refuses anything else. */
const MEMORY_SNAPSHOT_TYPE = 'archivist-memory-v1';
const MEMORY_SNAPSHOT_VERSION = 1;
/** Single snapshot entry key: the whole quad store serialised as N-Quads. */
const MEMORY_SNAPSHOT_KEY = 'nquads';

export const DAG_NS = 'https://noocodex.dev/ontology/dagonizer/';
export const BOOK_NS = 'urn:dagonizer:book:';
export const RUN_NS  = 'urn:dagonizer:run:';

/** Named-graph IRIs reserved by the Archivist demo. */
export const GRAPH_ONTOLOGY = namedNode('urn:dagonizer:ontology');
export const GRAPH_MEMORY   = namedNode('urn:dagonizer:memory');
export const STATE_GRAPH_PREFIX = 'urn:dagonizer:state:';
export const PROV_GRAPH_PREFIX  = 'urn:dagonizer:prov:';

/**
 * One bound row from `select()`. Keys are pattern variable names without
 * the leading `?`. Values are the raw n3 terms (NamedNode | Literal | …).
 */
export type Binding = Readonly<Record<string, Term>>;

interface SlotPattern {
  readonly subject?:   Term | string;
  readonly predicate?: Term | string;
  readonly object?:    Term | string;
  readonly graph?:     Term | string;
}

export class MemoryStore implements SnapshottableInterface {
  readonly #store = new Store();
  /** Auto-persist writes to localStorage when true (browser only). */
  #persist = false;

  /**
   * Hydrate from localStorage and enable auto-persistence. Safe to call
   * in Node (no-ops) since we check for `localStorage`.
   */
  enablePersistence(): void {
    if (typeof localStorage === 'undefined') return;
    this.#persist = true;
    const dump = localStorage.getItem(LOCALSTORAGE_KEY);
    if (dump === null || dump.length === 0) return;
    try {
      const parser = new Parser({ 'format': 'N-Quads' });
      const quads = parser.parse(dump);
      for (const q of quads) this.#store.addQuad(q);
    } catch {
      localStorage.removeItem(LOCALSTORAGE_KEY);
    }
  }

  /**
   * Disable auto-persistence and remove the stored dump from localStorage.
   * Subsequent writes are held only in memory until `enablePersistence()` is
   * called again. Safe to call in Node (no-ops).
   */
  disablePersistence(): void {
    this.#persist = false;
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(LOCALSTORAGE_KEY);
    }
  }

  /** True when writes are being auto-persisted to localStorage. */
  get isPersisted(): boolean { return this.#persist; }

  /** Total quad count; useful for the live UI counter. */
  get size(): number { return this.#store.size; }

  /** Pre-bake a named-node IRI for the `dag:` vocabulary. */
  static dagIri(local: string): NamedNode { return namedNode(`${DAG_NS}${local}`); }
  /** Pre-bake a named-node IRI for a candidate book by ISBN. */
  static bookIri(isbn: string): NamedNode { return namedNode(`${BOOK_NS}${isbn}`); }
  /** Per-run subject IRI. */
  static runIri(id: string):   NamedNode { return namedNode(`${RUN_NS}${id}`); }
  /** Make any IRI. */
  static iri(value: string):   NamedNode { return namedNode(value); }
  /** Named-graph IRI for the per-run typed-state mirror graph. */
  static stateGraphIri(runId: string): NamedNode { return namedNode(`${STATE_GRAPH_PREFIX}${runId}`); }
  /** Named-graph IRI for the per-run PROV-O activity log. */
  static provGraphIri(runId: string):  NamedNode { return namedNode(`${PROV_GRAPH_PREFIX}${runId}`); }

  /** Literal helpers: typed XSD where it matters for SPARQL FILTER. */
  static lit = {
    str(value: string):   Literal { return literal(value); },
    num(value: number):   Literal { return literal(String(value), namedNode('http://www.w3.org/2001/XMLSchema#double')); },
    int(value: number):   Literal { return literal(String(value), namedNode('http://www.w3.org/2001/XMLSchema#integer')); },
    bool(value: boolean): Literal { return literal(String(value), namedNode('http://www.w3.org/2001/XMLSchema#boolean')); },
    dateTime(value: Date): Literal { return literal(value.toISOString(), namedNode('http://www.w3.org/2001/XMLSchema#dateTime')); },
  };

  /**
   * Load the TBox ontology into `urn:dagonizer:ontology`.
   *
   * Accepts the `ONTOLOGY_NTRIPLES` array from `ArchivistOntology.ts`.
   * Idempotent: clears the graph before writing so repeated calls on
   * mount are safe.  The `typeof` guard lets tests supply any string[].
   */
  loadOntology(ntriples: readonly string[]): void {
    this.#store.removeQuads(this.#store.getQuads(null, null, null, GRAPH_ONTOLOGY));
    const parser = new Parser({ 'format': 'N-Triples' });
    const joined = ntriples.join('\n');
    const parsed = parser.parse(joined);
    for (const q of parsed) {
      this.#store.addQuad(
        quad(q.subject, q.predicate, q.object, GRAPH_ONTOLOGY),
      );
    }
    this.#flush();
  }

  /** Write one quad. `graph` defaults to the default graph. */
  assert(s: Quad_Subject, p: Quad_Predicate, o: Quad_Object, graph?: Quad_Graph): void {
    this.#store.addQuad(quad(s, p, o, graph ?? defaultGraph()));
    this.#flush();
  }

  /** Write many quads. Each quad carries its own graph. */
  assertAll(quads: readonly Quad[]): void {
    for (const q of quads) this.#store.addQuad(q);
    this.#flush();
  }

  /** ASK: true when at least one quad matches the pattern. */
  ask(pattern: SlotPattern): boolean {
    return this.#store.getQuads(
      MemoryStore.asTerm(pattern.subject)   ?? null,
      MemoryStore.asTerm(pattern.predicate) ?? null,
      MemoryStore.asTerm(pattern.object)    ?? null,
      MemoryStore.asTerm(pattern.graph)     ?? null,
    ).length > 0;
  }

  /**
   * SELECT: list bound rows. Variables: pass a string `?name` in any
   * slot and it becomes a binding key; concrete terms filter.
   */
  select(pattern: SlotPattern): Binding[] {
    const subject   = MemoryStore.asTerm(pattern.subject)   ?? null;
    const predicate = MemoryStore.asTerm(pattern.predicate) ?? null;
    const object    = MemoryStore.asTerm(pattern.object)    ?? null;
    const graph     = MemoryStore.asTerm(pattern.graph)     ?? null;
    const quads = this.#store.getQuads(subject, predicate, object, graph);
    return quads.map((q) => {
      const row: Record<string, Term> = {};
      if (MemoryStore.isVar(pattern.subject))   row[MemoryStore.stripQuestion(pattern.subject)]   = q.subject;
      if (MemoryStore.isVar(pattern.predicate)) row[MemoryStore.stripQuestion(pattern.predicate)] = q.predicate;
      if (MemoryStore.isVar(pattern.object))    row[MemoryStore.stripQuestion(pattern.object)]    = q.object;
      if (MemoryStore.isVar(pattern.graph))     row[MemoryStore.stripQuestion(pattern.graph)]     = q.graph;
      return row;
    });
  }

  /** Count matching quads. */
  count(pattern: SlotPattern): number {
    return this.#store.getQuads(
      MemoryStore.asTerm(pattern.subject)   ?? null,
      MemoryStore.asTerm(pattern.predicate) ?? null,
      MemoryStore.asTerm(pattern.object)    ?? null,
      MemoryStore.asTerm(pattern.graph)     ?? null,
    ).length;
  }

  /** Empty the entire store and the persisted dump. */
  clear(): void {
    this.#store.removeQuads(this.#store.getQuads(null, null, null, null));
    if (this.#persist && typeof localStorage !== 'undefined') {
      localStorage.removeItem(LOCALSTORAGE_KEY);
    }
  }

  /** Drop every quad in one named graph (useful when a run resets). */
  clearGraph(graph: Term): void {
    this.#store.removeQuads(this.#store.getQuads(null, null, null, graph));
    this.#flush();
  }

  /**
   * Drop every quad in `urn:dagonizer:memory` whose subject is typed as
   * `dag:Book` (i.e. has a `rdf:type dag:Book` triple). Safe to call
   * before re-seeding so the library stays idempotent across reloads.
   */
  clearBooks(): void {
    const rdfType = namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type');
    const dagBook = namedNode(`${DAG_NS}Book`);
    // Collect all book subject IRIs in GRAPH_MEMORY.
    const bookSubjects = this.#store
      .getQuads(null, rdfType, dagBook, GRAPH_MEMORY)
      .map((q) => q.subject.value);
    // Remove every quad whose subject is one of those book IRIs.
    for (const subjectValue of bookSubjects) {
      const subject = namedNode(subjectValue);
      this.#store.removeQuads(this.#store.getQuads(subject, null, null, GRAPH_MEMORY));
    }
    this.#flush();
  }

  /** Write the current store to localStorage as N-Quads. */
  #flush(): void {
    if (!this.#persist || typeof localStorage === 'undefined') return;
    const writer = new Writer({ 'format': 'N-Quads' });
    writer.addQuads(this.#store.getQuads(null, null, null, null));
    writer.end((err, result) => {
      if (err === null || err === undefined) {
        localStorage.setItem(LOCALSTORAGE_KEY, result);
      }
    });
  }

  /**
   * Capture the entire quad store (all named graphs) as a `StoreSnapshotType`.
   *
   * Satisfies the `SnapshottableInterface` contract so the store can ride along in
   * `Checkpoint.capture(dag, result, { stores: { memory } })`. The whole
   * store serialises to one N-Quads string entry; N-Quads carries the
   * graph term per quad, so ontology / memory / per-run graphs all round-trip.
   */
  // #region snapshottable-impl
  async snapshot(): Promise<StoreSnapshotType> {
    const nquads = await this.#serializeNquads();
    return {
      'version': MEMORY_SNAPSHOT_VERSION,
      'type':    MEMORY_SNAPSHOT_TYPE,
      'entries': [{ 'key': MEMORY_SNAPSHOT_KEY, 'value': nquads }],
    };
  }

  /**
   * Repopulate from a `StoreSnapshotType` produced by `snapshot()`. Clears the
   * current store first so restore is a full replace, not a merge. Refuses a
   * snapshot whose `type` / `version` doesn't match this store's format.
   */
  async restore(snapshot: StoreSnapshotType): Promise<void> {
    if (snapshot.type !== MEMORY_SNAPSHOT_TYPE) {
      throw new Error(`MemoryStore.restore: incompatible snapshot type '${snapshot.type}' (expected '${MEMORY_SNAPSHOT_TYPE}')`);
    }
    if (snapshot.version !== MEMORY_SNAPSHOT_VERSION) {
      throw new Error(`MemoryStore.restore: incompatible snapshot version ${String(snapshot.version)} (expected ${String(MEMORY_SNAPSHOT_VERSION)})`);
    }
    const entry = snapshot.entries.find((e) => e.key === MEMORY_SNAPSHOT_KEY);
    const nquads = typeof entry?.value === 'string' ? entry.value : '';

    this.#store.removeQuads(this.#store.getQuads(null, null, null, null));
    if (nquads.length > 0) {
      const parser = new Parser({ 'format': 'N-Quads' });
      for (const q of parser.parse(nquads)) this.#store.addQuad(q);
    }
    this.#flush();
  }
  // #endregion snapshottable-impl

  /** Serialise every quad in every graph to an N-Quads string. Promisified `Writer.end`. */
  #serializeNquads(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const writer = new Writer({ 'format': 'N-Quads' });
      writer.addQuads(this.#store.getQuads(null, null, null, null));
      writer.end((err, result) => {
        if (err === null || err === undefined) resolve(result);
        else reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  /** Iterate every quad in every graph. */
  *triples(): IterableIterator<Quad> {
    for (const q of this.#store.getQuads(null, null, null, null)) yield q;
  }

  /** Iterate every quad in a single named graph. */
  *triplesIn(graph: Term): IterableIterator<Quad> {
    for (const q of this.#store.getQuads(null, null, null, graph)) yield q;
  }

  /** Distinct graph IRIs the store currently knows about. */
  graphs(): readonly Term[] {
    const seen = new Map<string, Term>();
    for (const q of this.#store.getQuads(null, null, null, null)) {
      if (q.graph.termType === 'DefaultGraph') continue;
      if (!seen.has(q.graph.value)) seen.set(q.graph.value, q.graph);
    }
    return [...seen.values()];
  }

  private static isVar(slot: Term | string | undefined): slot is string {
    return typeof slot === 'string' && slot.startsWith('?');
  }

  private static stripQuestion(name: string): string {
    return name.startsWith('?') ? name.slice(1) : name;
  }

  private static asTerm(slot: Term | string | undefined): Term | null {
    if (slot === undefined) return null;
    if (MemoryStore.isVar(slot)) return null;
    if (typeof slot === 'string') return null;
    return slot;
  }
}
