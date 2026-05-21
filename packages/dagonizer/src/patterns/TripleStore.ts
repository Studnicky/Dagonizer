/**
 * TripleStore — minimal RDF quad-store contract every graph-tier pattern needs.
 *
 * Graph patterns (`RecallContextNode`, `RecordFindingsNode`,
 * `MemoryDigestNode`) operate against this interface — `services.memory`
 * in the consumer's bag must satisfy it. The Archivist's `MemoryStore`
 * (n3-backed, browser-compatible) is the canonical implementation.
 *
 * Kept intentionally narrow: pattern bases only need to assert quads,
 * select bound rows, count matches, clear a named graph, and iterate
 * the store. Richer query shapes (SPARQL UNION, FILTER, paths) belong
 * in consumer-specific subclasses that downcast to their concrete store.
 *
 * Term/Quad come from `@rdfjs/types`-compatible shapes. Patterns import
 * the minimal shapes here so they don't pull n3 into every consumer.
 */

/** RDF-JS Term — NamedNode, Literal, BlankNode, or DefaultGraph. */
export interface Term {
  readonly termType: 'NamedNode' | 'Literal' | 'BlankNode' | 'DefaultGraph' | 'Variable' | 'Quad';
  readonly value: string;
}

/** RDF-JS Quad — subject, predicate, object, graph. */
export interface Quad {
  readonly subject:   Term;
  readonly predicate: Term;
  readonly object:    Term;
  readonly graph:     Term;
}

/** One bound row from `select()`. Keys are pattern-variable names without the leading `?`. */
export type Binding = Readonly<Record<string, Term>>;

/** Basic graph pattern. Slots may be a concrete Term or a `?name` variable. */
export interface SlotPattern {
  readonly subject?:   Term | string;
  readonly predicate?: Term | string;
  readonly object?:    Term | string;
  readonly graph?:     Term | string;
}

export interface TripleStore {
  /** Write one quad. `graph` defaults to the default graph. */
  assert(subject: Term, predicate: Term, object: Term, graph?: Term): void;

  /** ASK — true when at least one quad matches the pattern. */
  ask(pattern: SlotPattern): boolean;

  /** SELECT — list bound rows. */
  select(pattern: SlotPattern): readonly Binding[];

  /** Count matching quads. */
  count(pattern: SlotPattern): number;

  /** Drop every quad in one named graph. */
  clearGraph(graph: Term): void;

  /** Iterate every quad in every graph. */
  triples(): IterableIterator<Quad>;
}
