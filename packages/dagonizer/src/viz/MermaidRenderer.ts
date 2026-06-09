/**
 * MermaidRenderer: render a `DAG` as Mermaid `flowchart` source.
 *
 * Static class. Output renders to a `flowchart LR` graph with one node
 * per placement and one edge per output route. Node-shape hints encode
 * the placement type:
 *
 *   single    → rectangle:       `nodeName[name]`
 *   scatter   → trapezoid:       `nodeName[/name/]`
 *   embedded  → subroutine:      `nodeName[[name]]`
 *   terminal (completed) → double-circle: `nodeName(((name\n(completed))))`
 *   terminal (failed)    → asymmetric flag: `nodeName>name\n(failed)]`
 *
 * Output routes render as labeled edges. Routes targeting `null` render
 * as edges to a synthetic `END` terminator (one per DAG). Explicit
 * `TerminalNode` placements render as their own distinct shapes and do
 * not emit edges (they are leaf placements; they end the flow).
 *
 * Containment coloring: any placement with a non-empty `container` role
 * (i.e. bound to a worker isolate) is assigned the Mermaid `contained`
 * class, rendered via a `classDef contained` rule emitted once at the
 * end of the flowchart. This changes only the fill/stroke color — the
 * `@type`-specific shape (subroutine, trapezoid, etc.) is preserved.
 * The color is the shared `WORKER_COLOR` constant from `internal.ts`
 * so Mermaid and Cytoscape use the same token.
 *
 * @example
 * ```ts
 * import { MermaidRenderer } from '@noocodex/dagonizer/viz';
 * const source = MermaidRenderer.render(myDag);
 * console.log(source);
 * ```
 */

import type { DAG } from '../entities/dag/DAG.js';
import type { EmbeddedDAGNode } from '../entities/dag/EmbeddedDAGNode.js';
import type { PhaseNodePlacementInterface } from '../entities/dag/PhaseNode.js';
import type { ScatterNode } from '../entities/dag/ScatterNode.js';
import type { SingleNodePlacementInterface } from '../entities/dag/SingleNode.js';
import type { TerminalNodePlacementInterface } from '../entities/dag/TerminalNode.js';

import { PlacementUtils, WORKER_COLOR } from './internal.js';

type AnyPlacement = EmbeddedDAGNode | ScatterNode | SingleNodePlacementInterface | TerminalNodePlacementInterface | PhaseNodePlacementInterface;

/**
 * Render a `DAG` as Mermaid `flowchart` source. Output is a complete
 * Mermaid block ready to embed in a Markdown ```mermaid fence.
 *
 * Placements bound to a `container` role receive the `contained` Mermaid
 * class (worker color `WORKER_COLOR`). In-process placements are unstyled
 * (Mermaid default). Select contained nodes in stylesheets via `.contained`.
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
    const containedIds: string[] = [];

    for (const placement of dag.nodes as readonly AnyPlacement[]) {
      lines.push(`  ${MermaidRenderer.renderShape(placement)}`);
      for (const edge of MermaidRenderer.renderEdges(placement)) {
        if (edge.endsWith(MermaidRenderer.TERMINAL_ID)) touchesTerminal = true;
        lines.push(edge);
      }
      // Track placements bound to a container role for class assignment below.
      if (PlacementUtils.containerRole(placement) !== null) {
        containedIds.push(placement.name);
      }
    }

    if (touchesTerminal) {
      lines.push(`  ${MermaidRenderer.TERMINAL_ID}([end])`);
    }

    // Emit containment class assignments and the shared classDef.
    // The classDef must follow all node/edge lines to be valid Mermaid.
    if (containedIds.length > 0) {
      // classDef uses amber-orange worker color (see WORKER_COLOR in internal.ts):
      //   fill: worker amber, stroke: darker amber border, color: dark text for contrast.
      lines.push(`  classDef contained fill:${WORKER_COLOR},stroke:#b45309,color:#1c1917`);
      for (const id of containedIds) {
        lines.push(`  class ${id} contained`);
      }
    }

    return lines.join('\n');
  }

  /** Escape a string for use inside a Mermaid double-quoted label. */
  private static escapeLabel(value: string): string {
    return value.replace(/"/gu, '#quot;');
  }

  /** Render a placement's Mermaid shape syntax (rectangle / trapezoid / double-circle / flag). */
  private static renderShape(placement: AnyPlacement): string {
    const label = MermaidRenderer.escapeLabel(placement.name);
    switch (placement['@type']) {
      case 'SingleNode':
        return `${placement.name}[${label}]`;
      case 'ScatterNode':
        // trapezoid: fork over a source
        return `${placement.name}[/${label}/]`;
      case 'EmbeddedDAGNode':
        // subroutine shape: a nested sub-DAG invocation
        return `${placement.name}[[${label}]]`;
      case 'TerminalNode': {
        const outcomeLabel = MermaidRenderer.escapeLabel(`${placement.name}\\n(${placement.outcome})`);
        if (placement.outcome === 'completed') {
          // double-circle: connotes "final state" in Mermaid
          return `${placement.name}(((${outcomeLabel})))`;
        }
        // asymmetric / flag shape for failed terminals
        return `${placement.name}>${outcomeLabel}]`;
      }
      case 'PhaseNode':
        // stadium shape: connotes a lifecycle hook (pre/post) wrapping a node
        return `${placement.name}([${MermaidRenderer.escapeLabel(placement.name)} (${placement.phase})])`;
    }
  }

  /** Render a placement's outbound edges as `from -->|label| to` lines. */
  private static renderEdges(placement: AnyPlacement): readonly string[] {
    // TerminalNode placements are leaf placements; they have no outputs field.
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
