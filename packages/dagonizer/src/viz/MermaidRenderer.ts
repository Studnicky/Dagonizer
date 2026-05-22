/**
 * MermaidRenderer — render a `DAG` as Mermaid `flowchart` source.
 *
 * Static class. Output renders to a `flowchart LR` graph with one node
 * per placement and one edge per output route. Node-shape hints encode
 * the placement type:
 *
 *   single    → rectangle:       `nodeName[name]`
 *   parallel  → subgraph wrapping its child node names
 *   fan-out   → hexagon:         `nodeName{{name}}`
 *   deep-dag  → stadium:         `nodeName([name])`
 *   terminal (completed) → double-circle: `nodeName(((name\n(completed))))`
 *   terminal (failed)    → asymmetric flag: `nodeName>name\n(failed)]`
 *
 * Output routes render as labeled edges. Routes targeting `null` render
 * as edges to a synthetic `END` terminator (one per DAG). Explicit
 * `TerminalNode` placements render as their own distinct shapes and do
 * not emit edges (they are leaf placements — they end the flow).
 *
 * @example
 * ```ts
 * import { MermaidRenderer } from '@noocodex/dagonizer/viz';
 * const source = MermaidRenderer.render(myDag);
 * console.log(source);
 * ```
 */

import type { DAG } from '../entities/dag/DAG.js';
import type { DeepDAGNode } from '../entities/dag/DeepDAGNode.js';
import type { FanOutNode } from '../entities/dag/FanOutNode.js';
import type { ParallelNode } from '../entities/dag/ParallelNode.js';
import type { SingleNodePlacementInterface } from '../entities/dag/SingleNode.js';
import type { TerminalNodePlacementInterface } from '../entities/dag/TerminalNode.js';

type AnyPlacement = FanOutNode | ParallelNode | SingleNodePlacementInterface | DeepDAGNode | TerminalNodePlacementInterface;

/**
 * Render a `DAG` as Mermaid `flowchart` source. Output is a complete
 * Mermaid block ready to embed in a Markdown ```mermaid fence.
 */
export class MermaidRenderer {
  private constructor() { /* static class */ }

  /** Synthetic terminator node ID emitted once per DAG that has any null-route. */
  private static readonly TERMINAL_ID = 'END';

  static render(dag: DAG): string {
    const lines: string[] = [];
    lines.push('flowchart LR');
    lines.push(`  %% ${dag.name} (v${dag.version})`);
    lines.push(`  ${dag.entrypoint}`);

    let touchesTerminal = false;

    for (const placement of dag.nodes as readonly AnyPlacement[]) {
      if (placement['@type'] === 'ParallelNode') {
        lines.push(`  subgraph ${placement.name}["${MermaidRenderer.escapeLabel(placement.name)} (parallel)"]`);
        for (const childName of placement.nodes) {
          lines.push(`    ${childName}[${MermaidRenderer.escapeLabel(childName)}]`);
        }
        lines.push('  end');
      } else {
        lines.push(`  ${MermaidRenderer.renderShape(placement)}`);
      }
      for (const edge of MermaidRenderer.renderEdges(placement)) {
        if (edge.endsWith(MermaidRenderer.TERMINAL_ID)) touchesTerminal = true;
        lines.push(edge);
      }
    }

    if (touchesTerminal) {
      lines.push(`  ${MermaidRenderer.TERMINAL_ID}([end])`);
    }

    return lines.join('\n');
  }

  /** Escape a string for use inside a Mermaid double-quoted label. */
  private static escapeLabel(value: string): string {
    return value.replace(/"/gu, '#quot;');
  }

  /** Render a placement's Mermaid shape syntax (rectangle / hexagon / stadium / double-circle / flag). */
  private static renderShape(placement: AnyPlacement): string {
    const label = MermaidRenderer.escapeLabel(placement.name);
    switch (placement['@type']) {
      case 'SingleNode':
        return `${placement.name}[${label}]`;
      case 'FanOutNode':
        return `${placement.name}{{${label}}}`;
      case 'DeepDAGNode':
        return `${placement.name}([${label}])`;
      case 'ParallelNode':
        // parallel placements render as subgraphs, not single shapes
        return placement.name;
      case 'TerminalNode': {
        const outcomeLabel = MermaidRenderer.escapeLabel(`${placement.name}\\n(${placement.outcome})`);
        if (placement.outcome === 'completed') {
          // double-circle — connotes "final state" in Mermaid
          return `${placement.name}(((${outcomeLabel})))`;
        }
        // asymmetric / flag shape for failed terminals
        return `${placement.name}>${outcomeLabel}]`;
      }
    }
  }

  /** Render a placement's outbound edges as `from -->|label| to` lines. */
  private static renderEdges(placement: AnyPlacement): readonly string[] {
    // TerminalNode placements are leaf placements — they have no outputs field.
    if (!('outputs' in placement)) return [];
    const lines: string[] = [];
    for (const [outputName, target] of Object.entries(placement.outputs)) {
      const dest = target ?? MermaidRenderer.TERMINAL_ID;
      const labelText = MermaidRenderer.escapeLabel(outputName);
      lines.push(`  ${placement.name} -->|${labelText}| ${dest}`);
    }
    return lines;
  }
}
