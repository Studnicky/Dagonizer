/**
 * `@studnicky/dagonizer/viz`: DAG visualization helpers.
 *
 *   - `MermaidRenderer.render(dag)`: Mermaid `flowchart` source for
 *     embedding in Markdown or feeding to a Mermaid renderer.
 *   - `JsonLdRenderer.render(dag)`: JSON-LD document for handing
 *     a DAG to graph databases, ontology projectors, or any other
 *     RDF-aware consumer in the noocodec stack.
 *   - `CytoscapeRenderer.render(dag)`: Cytoscape `elements` array for
 *     mounting an interactive DAG view in a browser (live-highlight
 *     active nodes, drag the layout, click for inspection).
 *   - `CytoscapeGraph`: subclassable factory that builds a fully
 *     configured `cytoscape.Core` (elements + canonical stylesheet +
 *     preset layout) from a `DAG`. The `cytoscape` peer is loaded lazily
 *     via `Cytoscape.create`; subclass `CytoscapeGraph` to layer on
 *     live-run animation.
 *   - `Cytoscape`: domain module whose `Cytoscape.create(options)` static
 *     dynamic-imports the optional `cytoscape` peer and constructs a `Core`.
 */

export { MermaidRenderer } from './MermaidRenderer.js';
export type { MermaidRenderOptionsType } from './MermaidRenderer.js';
export { MermaidExplorer } from './MermaidExplorer.js';
export type { MermaidExplorerOptionsType, MermaidExplorerThemeType } from './MermaidExplorer.js';
export { JsonLdRenderer, DAGONIZER_VOCAB, DagJsonLdDocumentSchema } from './JsonLdRenderer.js';
export type { DagJsonLdDocumentType, JsonLdGraphEntryType } from './JsonLdRenderer.js';
export { CytoscapeRenderer } from './CytoscapeRenderer.js';
export type {
  CytoscapeElementType,
  CytoscapeNodeDataType,
  CytoscapeNodeElementType,
  CytoscapeEdgeElementType,
  RenderOptionsType,
} from './CytoscapeRenderer.js';
export { CompositeLayout } from './CompositeLayout.js';
export type {
  NodePositionType,
  LayoutResultType,
  CompositeLayoutOptionsType,
} from './CompositeLayout.js';
export { Cytoscape } from './Cytoscape.js';
export { CytoscapeGraph } from './CytoscapeGraph.js';
export type {
  CytoscapeGraphInterface,
  CytoscapeGraphOptionsType,
} from './CytoscapeGraph.js';
