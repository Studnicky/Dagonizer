/**
 * Render the Archivist DAG as Cytoscape elements (sync, no DOM).
 *
 * Calls `CytoscapeRenderer.render(archivistDAG, { embeddedDAGs })` with
 * both embedded sub-DAGs registered so the renderer expands them inline
 * as compound-graph children. Logs the total element count to stdout.
 * No Cytoscape instance is created; the element array is the output.
 *
 * @example
 * ```ts
 * // docs/guide/archivist.md
 * // <<<examples/the-archivist/viz/render-cytoscape.ts
 * ```
 */

// #region cytoscape-render
import { CytoscapeRenderer } from '@studnicky/dagonizer/viz';

import { archivistDAG } from '../dag.ts';
import { bookSearchScatterDAG } from '../embedded-dags/BookSearchScatterDAG.ts';
import { composeRetryLoopDAG } from '../embedded-dags/ComposeRetryLoopDAG.ts';

const embeddedDAGs = new Map([
  ['book-search-scatter', bookSearchScatterDAG],
  ['compose-retry-loop',  composeRetryLoopDAG],
]);

const elements = CytoscapeRenderer.render(archivistDAG, { embeddedDAGs });

const nodeCount = elements.filter((el) => el.group === 'nodes').length;
const edgeCount = elements.filter((el) => el.group === 'edges').length;

console.log(`elements: ${elements.length} (${nodeCount} nodes, ${edgeCount} edges)`);
// #endregion cytoscape-render
