/** Shared namespaces and context fragments used by every JSON-LD boundary. */
export class DagonizerContexts {
  private constructor() { /* static-only */ }

  static readonly NAMESPACES = {
    'dag': 'https://noocodec.dev/ontology/dag/',
    'dagonizer': 'https://noocodec.dev/ontology/dagonizer/',
    'rdf': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    'xsd': 'http://www.w3.org/2001/XMLSchema#',
    'prov': 'http://www.w3.org/ns/prov#',
  } as const;

  static readonly GRAPH_STATE: Record<string, unknown> = {
    '@version': 1.1,
    '@vocab': DagonizerContexts.NAMESPACES.dagonizer,
    'dag': DagonizerContexts.NAMESPACES.dag,
    'dagonizer': DagonizerContexts.NAMESPACES.dagonizer,
    'rdf': DagonizerContexts.NAMESPACES.rdf,
    'xsd': DagonizerContexts.NAMESPACES.xsd,
    'prov': DagonizerContexts.NAMESPACES.prov,
  };
}
