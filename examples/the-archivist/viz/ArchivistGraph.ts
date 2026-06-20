/**
 * ArchivistGraph: minimal `CytoscapeGraph` subclass for the Archivist DAG.
 *
 * Overrides `composeElements()` to enrich every node element's `data.variant`
 * from `NODE_VARIANTS`, making it available to Cytoscape stylesheets via
 * `node[variant="deterministic"]` and `node[variant="non-deterministic"]`
 * selectors. The base `CytoscapeGraph` stylesheet already defines visual
 * rules for both variants (dashed violet border for non-deterministic nodes).
 *
 * Cytoscape is resolved internally by `CytoscapeGraph` via a lazy
 * `Cytoscape.create()` dynamic import; consumers no longer pass the
 * `cytoscape` function. A subclass that needs a custom `cytoscape.Core`
 * build (extensions registered, headless harness) overrides the protected
 * `construct(options)` hook instead.
 *
 * @example
 * ```ts
 * import { ArchivistGraph } from './viz/ArchivistGraph.ts';
 * import { archivistDAG } from './dag.ts';
 * import { BookSearchScatterDAG } from './embedded-dags/BookSearchScatterDAG.ts';
 * import { ComposeRetryLoopDAG }  from './embedded-dags/ComposeRetryLoopDAG.ts';
 *
 * const embeddedDAGs = new Map([
 *   ['book-search-scatter', BookSearchScatterDAG],
 *   ['compose-retry-loop',  ComposeRetryLoopDAG],
 * ]);
 * const graph = new ArchivistGraph(containerEl, archivistDAG, { embeddedDAGs });
 * const cy = await graph.mount();
 * ```
 */

// #region cytoscape-graph-subclass
import { CytoscapeGraph }  from '@studnicky/dagonizer/viz';
import { CytoscapeRenderer } from '@studnicky/dagonizer/viz';
import type { CytoscapeElementType, CytoscapeGraphOptionsType } from '@studnicky/dagonizer/viz';
import { NODE_VARIANTS } from '../nodes/ArchivistNode.ts';

/**
 * `CytoscapeGraph` subclass that annotates every rendered node element with
 * `data.variant` from the Archivist's `NODE_VARIANTS` registry. Stylesheets can then
 * select `node[variant="non-deterministic"]` to apply the dashed violet border.
 */
export class ArchivistGraph extends CytoscapeGraph {
  constructor(
    container: ConstructorParameters<typeof CytoscapeGraph>[0],
    dag: ConstructorParameters<typeof CytoscapeGraph>[1],
    options: CytoscapeGraphOptionsType = {},
  ) {
    super(container, dag, options);
  }

  /**
   * Render the DAG elements and enrich each node's `data.variant` from
   * `NODE_VARIANTS`. Nodes absent from the registry are emitted unchanged.
   */
  protected override composeElements(): ReadonlyArray<CytoscapeElementType> {
    const raw = CytoscapeRenderer.render(this.dag, {
      embeddedDAGs: this.embeddedDAGs,
    });

    return raw.map((el) => {
      if (el.group !== 'nodes') return el;
      const nodeName = el.data.node ?? el.data.id;
      const variant = NODE_VARIANTS[nodeName];
      if (variant === undefined) return el;
      return { ...el, data: { ...el.data, variant } };
    });
  }
}
// #endregion cytoscape-graph-subclass
