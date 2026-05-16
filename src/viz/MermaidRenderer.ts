/**
 * MermaidRenderer — render a `DAG` as Mermaid `flowchart` source.
 *
 * Static class. Output renders to a `flowchart LR` graph with one node
 * per placement and one edge per output route. Node-shape hints encode
 * the placement type:
 *
 *   single   → rectangle:    `nodeName[name]`
 *   parallel → subgraph wrapping its child node names
 *   fan-out  → hexagon:      `nodeName{{name}}`
 *   sub-dag  → stadium:      `nodeName([name])`
 *
 * Output routes render as labeled edges. Routes targeting `null` render
 * as edges to a synthetic `END` terminator (one per DAG).
 *
 * @example
 * ```ts
 * import { MermaidRenderer } from '@noocodex/dagonizer/viz';
 * const source = MermaidRenderer.render(myDag);
 * console.log(source);
 * ```
 */

import type { DAG } from '../entities/dag/DAG.js';
import type { FanOutNode } from '../entities/dag/FanOutNode.js';
import type { ParallelNode } from '../entities/dag/ParallelNode.js';
import type { SingleNodePlacementInterface } from '../entities/dag/SingleNode.js';
import type { SubDAGNode } from '../entities/dag/SubDAGNode.js';

type AnyPlacement = FanOutNode | ParallelNode | SingleNodePlacementInterface | SubDAGNode;

const TERMINAL_ID = 'END';

const escapeLabel = (value: string): string => value.replace(/"/gu, '#quot;');

const renderShape = (placement: AnyPlacement): string => {
  const label = escapeLabel(placement.name);
  switch (placement.type) {
    case 'single':
      return `${placement.name}[${label}]`;
    case 'fan-out':
      return `${placement.name}{{${label}}}`;
    case 'sub-dag':
      return `${placement.name}([${label}])`;
    case 'parallel':
      // parallel placements render as subgraphs, not single shapes
      return placement.name;
  }
};

const renderEdges = (placement: AnyPlacement): readonly string[] => {
  const lines: string[] = [];
  for (const [outputName, target] of Object.entries(placement.outputs)) {
    const dest = target ?? TERMINAL_ID;
    const labelText = escapeLabel(outputName);
    lines.push(`  ${placement.name} -->|${labelText}| ${dest}`);
  }
  return lines;
};

/**
 * Render a `DAG` as Mermaid `flowchart` source. Output is a complete
 * Mermaid block ready to embed in a Markdown ```mermaid fence.
 */
export class MermaidRenderer {
  private constructor() { /* static class */ }

  static render(dag: DAG): string {
    const lines: string[] = [];
    lines.push('flowchart LR');
    lines.push(`  %% ${dag.name} (v${dag.version})`);
    lines.push(`  ${dag.entrypoint}`);

    let touchesTerminal = false;

    for (const placement of dag.nodes as readonly AnyPlacement[]) {
      if (placement.type === 'parallel') {
        lines.push(`  subgraph ${placement.name}["${escapeLabel(placement.name)} (parallel)"]`);
        for (const childName of placement.nodes) {
          lines.push(`    ${childName}[${escapeLabel(childName)}]`);
        }
        lines.push('  end');
      } else {
        lines.push(`  ${renderShape(placement)}`);
      }
      for (const edge of renderEdges(placement)) {
        if (edge.endsWith(TERMINAL_ID)) touchesTerminal = true;
        lines.push(edge);
      }
    }

    if (touchesTerminal) {
      lines.push(`  ${TERMINAL_ID}([end])`);
    }

    return lines.join('\n');
  }
}
