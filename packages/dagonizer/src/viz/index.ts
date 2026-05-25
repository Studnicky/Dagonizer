/**
 * `@noocodex/dagonizer/viz` — DAG visualization helpers.
 *
 *   - `MermaidRenderer.render(dag)`  — Mermaid `flowchart` source for
 *     embedding in Markdown or feeding to a Mermaid renderer.
 *   - `JsonLdRenderer.render(dag)`   — JSON-LD document for handing
 *     a DAG to graph databases, ontology projectors, or any other
 *     RDF-aware consumer in the noocodex stack.
 *   - `CytoscapeRenderer.render(dag)` — Cytoscape `elements` array for
 *     mounting an interactive DAG view in a browser (live-highlight
 *     active nodes, drag the layout, click for inspection).
 */

export { MermaidRenderer } from './MermaidRenderer.js';
export { JsonLdRenderer, DAGONIZER_VOCAB } from './JsonLdRenderer.js';
export type { DagJsonLdDocument, JsonLdGraphEntry } from './JsonLdRenderer.js';
export { CytoscapeRenderer } from './CytoscapeRenderer.js';
export type {
  CytoscapeElement,
  CytoscapeNodeElement,
  CytoscapeEdgeElement,
} from './CytoscapeRenderer.js';
export { CompositeLayout } from './CompositeLayout.js';
export type {
  NodePosition,
  LayoutResult,
  CompositeLayoutOptions,
} from './CompositeLayout.js';
