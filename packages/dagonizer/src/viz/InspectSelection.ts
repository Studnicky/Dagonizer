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

export class InspectSelection {
  private constructor() { /* static-only */ }

  static dagNode(name: string): DagNodeSelectionType {
    return { 'variant': 'dag-node', name };
  }

  static iri(iri: string): IriSelectionType {
    return { 'variant': 'iri', iri };
  }

  static literal(value: string): LiteralSelectionType {
    return { 'variant': 'literal', value };
  }
}
