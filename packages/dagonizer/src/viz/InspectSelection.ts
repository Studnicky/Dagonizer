export type DagNodeSelectionType = {
  readonly 'variant': 'dag-node';
  readonly 'name': string;
};

export type IriSelectionType = {
  readonly 'variant': 'iri';
  readonly 'iri': string;
};

export type LiteralSelectionType = {
  readonly 'variant': 'literal';
  readonly 'value': string;
};

export type InspectSelectionType =
  | DagNodeSelectionType
  | IriSelectionType
  | LiteralSelectionType;

export function dagNodeSelection(name: string): DagNodeSelectionType {
  return { 'variant': 'dag-node', name };
}

export function iriSelection(iri: string): IriSelectionType {
  return { 'variant': 'iri', iri };
}

export function literalSelection(value: string): LiteralSelectionType {
  return { 'variant': 'literal', value };
}
