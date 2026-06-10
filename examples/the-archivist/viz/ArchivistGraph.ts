/**
 * ArchivistGraph: minimal `CytoscapeGraph` subclass for the Archivist DAG.
 *
 * Overrides `buildElements()` to enrich every node element's `data.kind`
 * from `NODE_KINDS`, making it available to Cytoscape stylesheets via
 * `node[kind="deterministic"]` and `node[kind="non-deterministic"]`
 * selectors. The base `CytoscapeGraph` stylesheet already defines visual
 * rules for both kinds (dashed violet border for non-deterministic nodes).
 *
 * Cytoscape is dependency-injected: this module uses `import type` only
 * so it never imports cytoscape as a value. Pass the `cytoscape` function
 * at construction time, as `CytoscapeGraph` requires.
 *
 * @example
 * ```ts
 * import cytoscape from 'cytoscape';
 * import { ArchivistGraph } from './viz/ArchivistGraph.ts';
 * import { archivistDAG } from './dag.ts';
 * import { BookSearchScatterDAG } from './embedded-dags/BookSearchScatterDAG.ts';
 * import { ComposeRetryLoopDAG }  from './embedded-dags/ComposeRetryLoopDAG.ts';
 *
 * const embeddedDAGs = new Map([
 *   ['book-search-scatter', BookSearchScatterDAG],
 *   ['compose-retry-loop',  ComposeRetryLoopDAG],
 * ]);
 * const graph = new ArchivistGraph(cytoscape, containerEl, archivistDAG, { embeddedDAGs });
 * const cy = await graph.mount();
 * ```
 */

// #region cytoscape-graph-subclass
import { CytoscapeGraph }  from '@noocodex/dagonizer/viz';
import { CytoscapeRenderer } from '@noocodex/dagonizer/viz';
import type { CytoscapeElement, CytoscapeGraphOptions } from '@noocodex/dagonizer/viz';
import { NODE_KINDS } from '../nodes/ArchivistNode.ts';

/**
 * `CytoscapeGraph` subclass that annotates every rendered node element with
 * `data.kind` from the Archivist's `NODE_KINDS` registry. Stylesheets can then
 * select `node[kind="non-deterministic"]` to apply the dashed violet border.
 */
export class ArchivistGraph extends CytoscapeGraph {
  constructor(
    cytoscapeFactory: ConstructorParameters<typeof CytoscapeGraph>[0],
    container: ConstructorParameters<typeof CytoscapeGraph>[1],
    dag: ConstructorParameters<typeof CytoscapeGraph>[2],
    options: Partial<CytoscapeGraphOptions> = {},
  ) {
    super(cytoscapeFactory, container, dag, options);
  }

  /**
   * Render the DAG elements and enrich each node's `data.kind` from
   * `NODE_KINDS`. Nodes absent from the registry are emitted unchanged.
   */
  protected override buildElements(): ReadonlyArray<CytoscapeElement> {
    const raw = CytoscapeRenderer.render(this.dag, {
      embeddedDAGs: this.embeddedDAGs,
    });

    return raw.map((el) => {
      if (el.group !== 'nodes') return el;
      const nodeName = el.data.node ?? el.data.id;
      const kind = NODE_KINDS[nodeName];
      if (kind === undefined) return el;
      return { ...el, data: { ...el.data, kind } };
    });
  }
}
// #endregion cytoscape-graph-subclass
