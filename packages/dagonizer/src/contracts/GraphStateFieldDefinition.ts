/** Describes a schema-owned RDF field projected into a node run graph. */
export type GraphStateFieldDefinitionType = {
  readonly key: string;
  readonly predicate: string;
  readonly kind: 'literal' | 'object' | 'array' | 'opaque';
  readonly cardinality: 'one' | 'many';
  readonly read: 'direct' | 'opaque';
  readonly write: 'replace' | 'append';
  readonly datatype?: string;
  readonly nested?: Readonly<Record<string, GraphStateNestedFieldDefinitionType>>;
};

/** Describes a directly queryable nested RDF property. */
export type GraphStateNestedFieldDefinitionType = {
  readonly predicate: string;
  readonly datatype?: string;
};
