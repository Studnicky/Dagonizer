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
import { MermaidRenderer } from '@noocodex/dagonizer/viz';
import { archivistDAG }    from '../dag.ts';

const flowchartSource = MermaidRenderer.render(archivistDAG);

console.log(flowchartSource);
// #endregion mermaid-render
