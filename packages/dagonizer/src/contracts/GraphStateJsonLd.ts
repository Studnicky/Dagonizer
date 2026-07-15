/** JSON-LD graph-state value used at Node.js graph boundaries. */
export type GraphStateJsonLdValueType = string | number | boolean | null | {
  readonly '@id': string | GraphStateJsonLdNodeType;
} | {
  readonly '@value': string;
  readonly '@type'?: string;
  readonly '@language'?: string;
};

/** One JSON-LD subject within a graph. */
export type GraphStateJsonLdNodeType = {
  readonly '@id': string;
  readonly [predicate: string]: GraphStateJsonLdValueType | readonly GraphStateJsonLdValueType[] | string;
};

/** One graph entry in the state IR; an omitted identifier denotes the default graph. */
export type GraphStateJsonLdGraphType = {
  readonly '@id'?: string;
  readonly '@graph': readonly GraphStateJsonLdNodeType[];
};

/** Context-bound JSON-LD IR exchanged between graph adapters and Node.js. */
export type GraphStateJsonLdDocumentType = {
  readonly '@context': Record<string, unknown>;
  readonly '@graph': readonly GraphStateJsonLdGraphType[];
};
