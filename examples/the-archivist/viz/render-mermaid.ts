/**
 * Render the Archivist DAG as Mermaid flowchart source.
 *
 * Calls `MermaidRenderer.render(archivistDAG)` and logs the complete
 * `flowchart LR` block to stdout. Paste the output into a Mermaid fence
 * or feed it to any Mermaid renderer.
 *
 * @example
 * ```ts
 * // docs/guide/archivist.md
 * // <<<examples/the-archivist/viz/render-mermaid.ts
 * ```
 */

// #region mermaid-render
import { MermaidRenderer } from '@studnicky/dagonizer/viz';
import { Dagonizer }       from '@studnicky/dagonizer';

import { archivistDAG } from '../dag.ts';

const flowchartSource = MermaidRenderer.render(archivistDAG);

console.log(flowchartSource);
// #endregion mermaid-render

// #region list-dags-render
// Read-accessor pattern: pull every registered DAG and render each one.
// `dispatcher.listDAGs()` returns all DAGs registered with registerDAG().
const dispatcher = new Dagonizer();
dispatcher.registerDAG(archivistDAG);

const sources = dispatcher.listDAGs().map((dag) => ({
  name:    dag.name,
  mermaid: MermaidRenderer.render(dag),
}));
console.log(`rendered ${sources.length} DAG(s): ${sources.map((s) => s.name).join(', ')}`);
// #endregion list-dags-render
