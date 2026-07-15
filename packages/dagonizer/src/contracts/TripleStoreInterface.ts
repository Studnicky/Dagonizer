/**
 * TripleStoreInterface: minimal RDF quad-store contract every graph-tier pattern needs.
 *
 * Graph patterns (`RecallContextNode`, `RecordFindingsNode`,
 * `MemoryDigestNode`) operate against this interface; `services.memory`
 * in the consumer's services record must satisfy it. The Archivist's `MemoryStore`
 * (n3-backed, browser-compatible) is the canonical implementation.
 *
 * Kept intentionally narrow: pattern bases only need to assert quads,
 * select bound rows, count matches, clear a named graph, and iterate
 * the store. Richer query shapes (SPARQL UNION, FILTER, paths) belong
 * in consumer-specific subclasses that downcast to their concrete store.
 *
 * TermType/QuadType come from `@rdfjs/types`-compatible shapes. Patterns import
 * the minimal shapes here so they don't pull n3 into every consumer.
 */

/** RDF-JS named-node term. */
export type NamedNodeTermType = {
  termType: 'NamedNode';
  value: string;
};

/** RDF-JS literal term. Omitted datatype means xsd:string; language is exclusive with datatype. */
export type LiteralTermType = {
  termType: 'Literal';
  value: string;
  language?: string;
  datatype?: NamedNodeTermType;
};

/** RDF-JS TermType, including RDF 1.2 triple terms. */
export type TermType = NamedNodeTermType | LiteralTermType | {
  termType: 'BlankNode' | 'DefaultGraph' | 'Variable';
  value: string;
} | {
  /** An RDF 1.2 triple used as an RDF term. */
  termType: 'Quad';
  value: '';
  quad: QuadType;
};

/** RDF-JS QuadType: subject, predicate, object, graph. */
export type QuadType = {
  subject:   TermType;
  predicate: TermType;
  object:    TermType;
  graph:     TermType;
}

/** One bound row from `select()`. Keys are pattern-variable names without the leading `?`. */
export type BindingType = Record<string, TermType>;

/** Basic graph pattern. Slots may be a concrete TermType or a `?name` variable. */
export type SlotPatternType = {
  subject?:   TermType | string;
  predicate?: TermType | string;
  object?:    TermType | string;
  graph?:     TermType | string;
}

export interface TripleStoreInterface {
  /** Write one quad. `graph` defaults to the default graph. */
  assert(subject: TermType, predicate: TermType, object: TermType, graph?: TermType): void;

  /** ASK: true when at least one quad matches the pattern. */
  ask(pattern: SlotPatternType): boolean;

  /** SELECT: list bound rows. */
  select(pattern: SlotPatternType): readonly BindingType[];

  /** Count matching quads. */
  count(pattern: SlotPatternType): number;

  /** Drop every quad in one named graph. */
  clearGraph(graph: TermType): void;

  /** Iterate every quad in every graph. */
  triples(): IterableIterator<QuadType>;
}
