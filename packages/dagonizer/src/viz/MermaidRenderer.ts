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
 * import { MermaidRenderer } from '@studnicky/dagonizer/viz';
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
    // Reservoir-configured scatter placement names (for classDef emission).
    const reservoirIds: string[] = [];

    for (const placement of PlacementUtils.narrowNodes(dag)) {
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
      // Track reservoir-configured ScatterNode placements.
      if (placement['@type'] === 'ScatterNode' && placement.reservoir !== undefined) {
        reservoirIds.push(placement.name);
      }
    }

    // Emit one classDef per distinct role, then assign each contained node
    // to its role-specific class. classDefs follow all node/edge lines.
    for (const [token, ids] of roleToIds) {
      const role = roleTokenToRole.get(token);
      // roleTokenToRole is populated in lockstep with roleToIds; every token in
      // roleToIds was inserted together with its original role in roleTokenToRole.
      if (role === undefined) continue;
      const colors = RoleColorUtils.forRole(role);
      lines.push(`  classDef contained-${token} fill:${colors.fill},stroke:${colors.stroke},color:${colors.text}`);
      for (const id of ids) {
        lines.push(`  class ${id} contained-${token}`);
      }
    }

    // Emit the reservoir classDef once (if any reservoir placements exist),
    // then assign each reservoir scatter to it. The fill/stroke are chosen to
    // read as "buffered / windowed" — distinct from all containment role colors.
    // Per-key fill and per-firing batch size are runtime values supplied by the
    // animation layer (not static output).
    if (reservoirIds.length > 0) {
      lines.push('  classDef reservoir fill:#1e3a5f,stroke:#3b82f6,color:#bfdbfe');
      for (const id of reservoirIds) {
        lines.push(`  class ${id} reservoir`);
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
      case 'ScatterNode': {
        if (placement.reservoir !== undefined) {
          // Reservoir-configured scatter: augment label with key/capacity marker.
          // Per-key fill and per-firing batch size are runtime values — the
          // animation layer renders them from observer buffer-size deltas.
          const reservoirLabel = MermaidRenderer.escapeLabel(
            `${placement.name}\\n▣ ${placement.reservoir.keyField} ×${placement.reservoir.capacity}`,
          );
          return `${placement.name}[/${reservoirLabel}/]`;
        }
        // Plain scatter (no reservoir): trapezoid shape.
        return `${placement.name}[/${label}/]`;
      }
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
