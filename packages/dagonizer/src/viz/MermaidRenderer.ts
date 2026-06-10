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
 * Output routes render as labeled edges. All routes must target named
 * placements — null routes are not permitted in the DAG model. Explicit
 * `TerminalNode` placements render as their own distinct shapes and do
 * not emit edges (they are leaf placements; they end the flow).
 *
 * Containment coloring: any placement with a non-empty `container` role
 * (i.e. bound to a worker isolate) is assigned a Mermaid class specific
 * to that role. One `classDef contained-<role>` rule is emitted per
 * distinct role that appears in the DAG — different roles produce different
 * fill/stroke colors (see `RoleColorUtils.forRole` in `internal.ts`). The
 * `@type`-specific shape (subroutine, trapezoid, etc.) is preserved; only
 * the color changes. A DAG with roles `cpu` and `io` emits two classDefs
 * with two different fills.
 *
 * @example
 * ```ts
 * import { MermaidRenderer } from '@noocodex/dagonizer/viz';
 * const source = MermaidRenderer.render(myDag);
 * console.log(source);
 * ```
 */

import type { DAG } from '../entities/dag/DAG.js';

import { PlacementUtils, RoleColorUtils } from './internal.js';
import type { PlacementEntry } from './internal.js';

/**
 * Render a `DAG` as Mermaid `flowchart` source. Output is a complete
 * Mermaid block ready to embed in a Markdown ```mermaid fence.
 *
 * Placements bound to a `container` role receive a per-role Mermaid class
 * (`contained-<sanitizedRole>`) whose fill/stroke comes from
 * `RoleColorUtils.forRole`. In-process placements are unstyled (Mermaid
 * default). A DAG with two distinct roles emits two distinct classDefs.
 */
export class MermaidRenderer {
  private constructor() { /* static class */ }

  static render(dag: DAG): string {
    const lines: string[] = [];
    lines.push('flowchart LR');
    lines.push(`  %% ${dag.name} (v${dag.version})`);
    lines.push(`  ${dag.entrypoint}`);

    // Map from sanitized role token → list of placement names assigned that token.
    const roleToIds = new Map<string, string[]>();
    // Map from sanitized role token → original role string (for color lookup).
    const roleTokenToRole = new Map<string, string>();

    for (const placement of dag.nodes as readonly PlacementEntry[]) {
      lines.push(`  ${MermaidRenderer.renderShape(placement)}`);
      for (const edge of MermaidRenderer.renderEdges(placement)) {
        lines.push(edge);
      }
      // Track contained placements grouped by their sanitized role token.
      const role = PlacementUtils.containerRole(placement);
      if (role !== null) {
        const token = MermaidRenderer.sanitizeRole(role, roleTokenToRole);
        roleTokenToRole.set(token, role);
        const ids = roleToIds.get(token) ?? [];
        ids.push(placement.name);
        roleToIds.set(token, ids);
      }
    }

    // Emit one classDef per distinct role, then assign each contained node
    // to its role-specific class. classDefs follow all node/edge lines.
    for (const [token, ids] of roleToIds) {
      const role = roleTokenToRole.get(token);
      // roleTokenToRole is populated in lockstep with roleToIds; the key always exists.
      if (role === undefined) continue;
      const colors = RoleColorUtils.forRole(role);
      lines.push(`  classDef contained-${token} fill:${colors.fill},stroke:${colors.stroke},color:${colors.text}`);
      for (const id of ids) {
        lines.push(`  class ${id} contained-${token}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Convert a role string to a valid Mermaid class identifier token
   * (alphanumeric + underscore only).
   *
   * If two different roles sanitize to the same token, the second one is
   * disambiguated with a numeric suffix (`_2`, `_3`, …) derived from the
   * order of insertion. The `existingTokens` map is checked and mutated
   * in-place so the caller maintains consistent state across all placements
   * in one render pass.
   *
   * Accepts `Map` (not `ReadonlyMap`) because the caller passes a mutable
   * map that it populates across the render pass; the method reads the map
   * to detect token collisions and the caller writes back the resolved token.
   */
  private static sanitizeRole(
    role: string,
    existingTokens: Map<string, string>,
  ): string {
    const base = role.replace(/[^a-zA-Z0-9_]/gu, '_');
    // Check whether this base token is already taken by a DIFFERENT role.
    const existing = existingTokens.get(base);
    if (existing === undefined || existing === role) return base;
    // Collision: find the next free numbered variant.
    let n = 2;
    let candidate = `${base}_${n}`;
    while (existingTokens.has(candidate) && existingTokens.get(candidate) !== role) {
      n++;
      candidate = `${base}_${n}`;
    }
    return candidate;
  }

  /** Escape a string for use inside a Mermaid double-quoted label. */
  private static escapeLabel(value: string): string {
    return value.replace(/"/gu, '#quot;');
  }

  /** Render a placement's Mermaid shape syntax (rectangle / trapezoid / double-circle / flag). */
  private static renderShape(placement: PlacementEntry): string {
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
  private static renderEdges(placement: PlacementEntry): readonly string[] {
    // TerminalNode placements are leaf placements; they have no outputs field.
    if (!('outputs' in placement)) return [];
    const lines: string[] = [];
    for (const [outputName, target] of Object.entries(placement.outputs)) {
      const labelText = MermaidRenderer.escapeLabel(outputName);
      lines.push(`  ${placement.name} -->|${labelText}| ${target}`);
    }
    return lines;
  }
}
