/**
 * MermaidRenderer: render a `DAG` as Mermaid `flowchart` source.
 *
 * Static class. Output renders to a `flowchart TB` graph (by default) with
 * one node per placement and one edge per output route. Node-shape hints
 * encode the placement type:
 *
 *   single    → rectangle:       `nodeName[name]`
 *   scatter   → trapezoid:       `nodeName[/name/]`
 *   embedded  → subroutine:      `nodeName[[name]]`
 *   terminal (completed) → double-circle: `nodeName(((name)))`
 *   terminal (failed)    → asymmetric flag: `nodeName>name]`
 *
 * Output routes render as labeled edges. All routes must target placement
 * IRIs — null routes are not permitted in the DAG model. Explicit
 * `TerminalNode` placements render as their own distinct shapes and do
 * not emit edges (they are leaf placements; they end the flow).
 *
 * Rendering-correctness passes applied by default (configurable via options):
 *
 *   - Orientation: `flowchart TB` (top-bottom) by default.
 *   - Node-id sanitization: colons in placement IRIs are replaced with `_`
 *     in bare ids while labels keep their original form, preventing Mermaid
 *     from lexing `:class`, `:end` etc. as reserved keywords.
 *   - Terminal-annotation strip: removes `\n(completed|failed|…)` suffixes
 *     and stray `\n` characters from terminal-node labels that would cause
 *     Mermaid parse errors.
 *   - Theme: optional concrete khroma-safe colours emitted via `classDef`.
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

import type { DAGType } from '../entities/dag/DAG.js';

import { PlacementUtils, RoleColorUtils } from './internal.js';
import type { PlacementDispatchType, PlacementEntryType } from './internal.js';

type MermaidIdIndexType = {
  readonly entrypointIds: ReadonlyMap<string, string>;
  readonly placementIds: ReadonlyMap<string, string>;
}

type MermaidDagViewType = {
  readonly name: string;
  readonly version: string;
  readonly entrypoints: Readonly<Record<string, string>>;
  readonly nodes: readonly object[];
};

/**
 * Rendering options for `MermaidRenderer.render`.
 *
 * All fields are optional; see `MERMAID_RENDER_DEFAULTS` for the safe
 * defaults that apply when fields are omitted.
 */
export type MermaidRenderOptionsType = {
  /** Flowchart layout direction. Default `'TB'` (top-to-bottom). */
  'orientation'?: 'TB' | 'LR' | 'RL' | 'BT';
  /**
   * Replace `:` in bare node IDs with `_` while keeping colons in visible
   * bracketed labels and never touching directive lines. Default `true`.
   */
  'sanitizeNodeIds'?: boolean;
  /**
   * Strip `\n(completed|failed|cancelled|timed-out)` outcome suffixes from
   * terminal-node labels. Mermaid parses `(` mid-label as a shape-start,
   * causing a parse error. Default `'strip'`.
   */
  'terminalAnnotations'?: 'strip' | 'keep';
  /**
   * Concrete khroma-safe colours. When provided, these override the default
   * hash-derived container fills. `containerTints[role]` overrides the fill
   * for that specific container role. Font and spacing values are emitted in
   * Mermaid's init directive so render-time layout uses the same typography as
   * the displayed SVG.
   */
  'theme'?: {
    'primaryColor'?: string;
    'lineColor'?: string;
    'textColor'?: string;
    'background'?: string;
    'fontFamily'?: string;
    'fontSize'?: string;
    'nodeSpacing'?: number;
    'rankSpacing'?: number;
    'padding'?: number;
    'containerTints'?: Record<string, string>;
  };
};

/** Safe defaults applied when options fields are omitted. */
const MERMAID_RENDER_DEFAULTS = {
  'orientation':         'TB'    as const,
  'sanitizeNodeIds':     true,
  'terminalAnnotations': 'strip' as const,
} satisfies Required<Omit<MermaidRenderOptionsType, 'theme'>>;

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

  static render(dag: DAGType | null | undefined, options?: MermaidRenderOptionsType): string {
    const opts = { ...MERMAID_RENDER_DEFAULTS, ...options };
    const theme = options?.theme;
    const view = MermaidRenderer.normalizeDag(dag);

    const idIndex = MermaidRenderer.composeIdIndex(view, opts.sanitizeNodeIds);
    const lines: string[] = [];
    const init = MermaidRenderer.renderInitDirective(theme);
    if (init !== null) lines.push(init);
    lines.push(`flowchart ${opts.orientation}`);
    lines.push(`  %% ${view.name} (v${view.version})`);
    for (const [label, placement] of Object.entries(view.entrypoints)) {
      const entryId = idIndex.entrypointIds.get(label) ?? MermaidRenderer.entryIdFor(label, opts.sanitizeNodeIds);
      lines.push(`  ${entryId}([${MermaidRenderer.label(label)}])`);
      lines.push(`  ${entryId} --> ${MermaidRenderer.idFor(placement, idIndex.placementIds, opts.sanitizeNodeIds)}`);
    }

    // Map from sanitized role token → list of placement IDs assigned that token.
    const roleToIds = new Map<string, string[]>();
    // Map from sanitized role token → original role string (for color lookup).
    const roleTokenToRole = new Map<string, string>();
    // Reservoir-configured scatter placement names (for classDef emission).
    const reservoirIds: string[] = [];

    for (const placement of PlacementUtils.narrowNodes(view)) {
      const placementId = MermaidRenderer.idFor(placement['@id'], idIndex.placementIds, opts.sanitizeNodeIds);
      lines.push(`  ${MermaidRenderer.renderShape(placement, placementId)}`);
      for (const edge of MermaidRenderer.renderEdges(placement, placementId, idIndex.placementIds, opts.sanitizeNodeIds)) {
        lines.push(edge);
      }
      // Track contained placements grouped by their sanitized role token.
      const role = PlacementUtils.containerRole(placement);
      if (role !== null) {
        const token = MermaidRenderer.sanitizeRole(role, roleTokenToRole);
        roleTokenToRole.set(token, role);
        const ids = roleToIds.get(token) ?? [];
        ids.push(placementId);
        roleToIds.set(token, ids);
      }
      // Track reservoir-configured ScatterNode placements.
      if (placement['@type'] === 'ScatterNode' && placement.execution !== undefined && placement.execution.mode === 'reservoir') {
        reservoirIds.push(placementId);
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
      // Apply containerTints theme override when provided for this role.
      const fill = theme?.containerTints?.[role] ?? colors.fill;
      lines.push(`  classDef contained-${token} fill:${fill},stroke:${colors.stroke},color:${colors.text}`);
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

    let output = lines.join('\n');

    // Pass: strip terminal `\n(outcome)` annotations from node shape lines.
    // Applied before id sanitization so the patterns are simpler.
    if (opts.terminalAnnotations === 'strip') {
      output = MermaidRenderer.stripTerminalAnnotations(output);
    }

    // Pass: sanitize colon-containing node IDs in any caller-provided bare-id
    // positions that were not normalized by the render pass above.
    if (opts.sanitizeNodeIds) {
      output = MermaidRenderer.sanitizeNodeIdsInSource(output);
    }

    return output;
  }

  /**
   * Strip `\n(completed|failed|cancelled|timed-out)` outcome suffixes and
   * any remaining literal `\n` from terminal-node shape lines.
   *
   * Only processes node-definition lines (lines that contain `[`, `(`, or
   * `>` shape markers). Directive lines (`flowchart`, `classDef`, `class `,
   * `style `, `linkStyle`, `subgraph`, `end`, `%%`) are not touched.
   */
  private static stripTerminalAnnotations(source: string): string {
    return source
      .split('\n')
      .map((line) => {
        if (MermaidRenderer.isDirectiveLine(line)) return line;
        // Remove literal \n followed by parenthesised outcome keyword.
        // The renderer emits the literal two-character sequence `\n` (backslash-n)
        // not a real newline — so the regex targets that literal sequence.
        return line
          .replace(/\\\\n\((completed|failed|cancelled|timed-out)\)/gu, '')
          .replace(/\\n\((completed|failed|cancelled|timed-out)\)/gu, '')
          .replace(/\\\\n/gu, ' ')
          .replace(/\\n/gu, ' ');
      })
      .join('\n');
  }

  /**
   * Replace `:` in bare node IDs with `_` while leaving colons inside
   * bracketed labels, pipe-delimited edge labels, and directive lines alone.
   *
   * Algorithm:
   *   1. Each line is classified: directive lines pass through untouched.
   *   2. For shape-definition lines and edge lines, mask label/pipe segments
   *      with placeholders, replace remaining `:` → `_`, then restore masks.
   *
   * Example: `  extract:class-base[extract:class-base]`
   *       →  `  extract_class-base[extract:class-base]`
   */
  private static sanitizeNodeIdsInSource(source: string): string {
    return source
      .split('\n')
      .map((line) => {
        if (MermaidRenderer.isDirectiveLine(line)) return line;
        return MermaidRenderer.sanitizeLineIds(line);
      })
      .join('\n');
  }

  /**
   * Unique prefix used as a masking sentinel during node-id sanitization.
   * Must not contain `:` (the character being replaced) and must not appear
   * in any legitimate Mermaid source line.
   */
  private static readonly MASK_PREFIX = '__MMSK';
  private static readonly MASK_SUFFIX = 'MMSK__';
  private static readonly RESERVED_NODE_IDS = new Set([
    'class',
    'classdef',
    'click',
    'default',
    'end',
    'flowchart',
    'graph',
    'linkstyle',
    'style',
    'subgraph',
  ]);

  /**
   * Sanitize colon-containing node IDs in a single non-directive source line.
   *
   * Masks all bracketed label segments `[…]`, `(…)`, `[[…]]`, `(((…)))`,
   * `>…]`, and pipe-segment labels `|…|` with numeric placeholders before
   * replacing `:` → `_` in bare positions, then restores the masked segments.
   */
  private static sanitizeLineIds(line: string): string {
    const masks: string[] = [];
    const pfx = MermaidRenderer.MASK_PREFIX;
    const sfx = MermaidRenderer.MASK_SUFFIX;

    const mask = (value: string): string => {
      const idx = masks.length;
      masks.push(value);
      return `${pfx}${idx}${sfx}`;
    };

    // Mask bracketed label regions (capture shapes + edge labels) so their
    // interior colons are not touched. Process greedily from most-specific
    // (triple-bracket) to least-specific (single-bracket).
    // Each interior negated class excludes its OWN opening delimiter char(s), not
    // only the closing one. That removes overlapping start positions (e.g. a
    // second '[[' inside a '[[...]]' match), so every pattern is linear — no
    // polynomial ReDoS on adversarial DAG labels (CodeQL js/polynomial-redos).
    const masked = line
      // triple-bracket subroutine: [[...]]
      .replace(/\[\[([^[\]]*)\]\]/gu, (_m, inner) => mask(`[[${inner}]]`))
      // triple-paren double-circle: (((...)))
      .replace(/\(\(\(([^()]*)\)\)\)/gu, (_m, inner) => mask(`(((${inner})))`))
      // asymmetric flag: >...]
      .replace(/>([^>\]]*)\]/gu, (_m, inner) => mask(`>${inner}]`))
      // trapezoid: [/.../
      .replace(/\[\/([^[/]*)\//gu, (_m, inner) => mask(`[/${inner}/`))
      // stadium: ([...])
      .replace(/\(\[([^([\]]*)\]\)/gu, (_m, inner) => mask(`([${inner}])`))
      // rectangle: [...] (must come after [[ and [/ variants)
      .replace(/\[([^[\]]*)\]/gu, (_m, inner) => mask(`[${inner}]`))
      // pipe-delimited edge label: |...|
      .replace(/\|([^|]*)\|/gu, (_m, inner) => mask(`|${inner}|`));

    // Replace remaining colons (bare node-id positions) with underscore.
    const sanitized = masked.replace(/:/gu, '_');

    // Restore masked segments. The sentinel pattern only matches our injected
    // placeholders, which contain no colons, so this replace is safe.
    return sanitized.replace(
      new RegExp(`${pfx}(\\d+)${sfx}`, 'gu'),
      (_m, idx) => masks[Number(idx)] ?? '',
    );
  }

  /**
   * Return `true` for lines that carry Mermaid directives or comments.
   * These lines are never modified by either sanitization pass.
   */
  private static isDirectiveLine(line: string): boolean {
    const trimmed = line.trimStart();
    return (
      trimmed.startsWith('%%{init:') ||
      trimmed.startsWith('flowchart') ||
      trimmed.startsWith('classDef') ||
      trimmed.startsWith('class ') ||
      trimmed.startsWith('style ') ||
      trimmed.startsWith('linkStyle') ||
      trimmed.startsWith('subgraph') ||
      trimmed === 'end' ||
      trimmed.startsWith('%%')
    );
  }

  /** Convert runtime DAG-like input into the subset Mermaid rendering needs. */
  private static normalizeDag(dag: DAGType | null | undefined): MermaidDagViewType {
    if (dag === null || dag === undefined) {
      return {
        'name':        'unavailable-dag',
        'version':     'unknown',
        'entrypoints': {},
        'nodes':       [],
      };
    }

    return {
      'name':        typeof dag.name === 'string' && dag.name.length > 0 ? dag.name : 'unnamed-dag',
      'version':     typeof dag.version === 'string' && dag.version.length > 0 ? dag.version : 'unknown',
      'entrypoints': MermaidRenderer.normalizeEntrypoints(dag.entrypoints),
      'nodes':       Array.isArray(dag.nodes) ? dag.nodes : [],
    };
  }

  /** Keep only usable entrypoint references so transient bad input cannot crash rendering. */
  private static normalizeEntrypoints(entrypoints: DAGType['entrypoints'] | null | undefined): Record<string, string> {
    if (entrypoints === null || entrypoints === undefined) return {};
    const normalized: Record<string, string> = {};
    for (const [label, placement] of Object.entries(entrypoints)) {
      if (typeof placement === 'string' && placement.length > 0) {
        normalized[label] = placement;
      }
    }
    return normalized;
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

  /** Compose deterministic Mermaid-safe ids for every entrypoint and placement IRI. */
  private static composeIdIndex(dag: MermaidDagViewType, sanitize: boolean): MermaidIdIndexType {
    const placementIds = new Map<string, string>();
    const entrypointIds = new Map<string, string>();
    const occupied = new Set<string>();

    for (const placement of PlacementUtils.narrowNodes(dag)) {
      const base = sanitize
        ? MermaidRenderer.sanitizeNodeId(placement['@id'])
        : placement['@id'];
      placementIds.set(placement['@id'], MermaidRenderer.reserveId(base, occupied));
    }

    for (const label of Object.keys(dag.entrypoints)) {
      const base = MermaidRenderer.entryIdFor(label, sanitize);
      entrypointIds.set(label, MermaidRenderer.reserveId(base, occupied));
    }

    return { entrypointIds, placementIds };
  }

  /** Return an id that is unique within `occupied`, then reserve it. */
  private static reserveId(base: string, occupied: Set<string>): string {
    let candidate = base;
    let suffix = 2;
    while (occupied.has(candidate)) {
      candidate = `${base}_${String(suffix)}`;
      suffix++;
    }
    occupied.add(candidate);
    return candidate;
  }

  /** Return the rendered Mermaid id for a placement IRI or a dangling target. */
  private static idFor(
    name: string,
    ids: ReadonlyMap<string, string>,
    sanitize: boolean,
  ): string {
    return ids.get(name) ?? (sanitize ? MermaidRenderer.sanitizeNodeId(name) : name);
  }

  /** Sanitize one Mermaid bare node id while preserving human labels elsewhere. */
  private static sanitizeNodeId(name: string): string {
    let id = name.replace(/:/gu, '_');
    if (/^[0-9]/u.test(id)) id = `node_${id}`;
    if (MermaidRenderer.RESERVED_NODE_IDS.has(id.toLowerCase())) return `${id}_node`;
    if (MermaidRenderer.hasReservedNodeIdPrefix(id)) id = `node_${id}`;
    return id;
  }

  /** Return a deterministic pseudo-node id for a DAG entrypoint label. */
  private static entryIdFor(label: string, sanitize: boolean): string {
    const id = sanitize ? MermaidRenderer.sanitizeNodeId(label) : label;
    return `entry_${id}`;
  }

  /** Return true when a bare id starts with a Mermaid reserved token. */
  private static hasReservedNodeIdPrefix(id: string): boolean {
    const lower = id.toLowerCase();
    for (const reserved of MermaidRenderer.RESERVED_NODE_IDS) {
      if (lower.startsWith(`${reserved}-`) || lower.startsWith(`${reserved}_`)) return true;
    }
    return false;
  }

  /** Escape a string for use inside a Mermaid double-quoted label. */
  private static escapeLabel(value: string): string {
    return value
      .replace(/\\/gu, '\\\\')
      .replace(/"/gu, '\\"');
  }

  /** Wrap a placement label in Mermaid's quoted text form. */
  private static label(value: string): string {
    return `"${MermaidRenderer.escapeLabel(value)}"`;
  }

  /** Emit a Mermaid init directive when render-time style/layout was provided. */
  private static renderInitDirective(theme: MermaidRenderOptionsType['theme']): string | null {
    if (theme === undefined) return null;

    const flowchart: Record<string, unknown> = {};
    if (theme.nodeSpacing !== undefined) flowchart['nodeSpacing'] = theme.nodeSpacing;
    if (theme.rankSpacing !== undefined) flowchart['rankSpacing'] = theme.rankSpacing;
    if (theme.padding !== undefined) flowchart['padding'] = theme.padding;

    const themeVariables: Record<string, string> = {};
    if (theme.primaryColor !== undefined) themeVariables['primaryColor'] = theme.primaryColor;
    if (theme.lineColor !== undefined) themeVariables['lineColor'] = theme.lineColor;
    if (theme.textColor !== undefined) themeVariables['primaryTextColor'] = theme.textColor;
    if (theme.background !== undefined) themeVariables['background'] = theme.background;
    if (theme.fontFamily !== undefined) themeVariables['fontFamily'] = theme.fontFamily;
    if (theme.fontSize !== undefined) themeVariables['fontSize'] = theme.fontSize;

    if (Object.keys(flowchart).length === 0 && Object.keys(themeVariables).length === 0) return null;

    return `%%{init: ${JSON.stringify({
      ...(Object.keys(flowchart).length > 0 ? { 'flowchart': flowchart } : {}),
      ...(Object.keys(themeVariables).length > 0 ? { 'themeVariables': themeVariables } : {}),
    })}}%%`;
  }

  /** Render a placement's Mermaid shape syntax (rectangle / trapezoid / double-circle / flag). */
  private static renderShape(placement: PlacementEntryType, id: string): string {
    const displayLabel = PlacementUtils.displayLabel(placement);
    const label = MermaidRenderer.label(displayLabel);
    const shapeDispatch: PlacementDispatchType<string> = {
      'SingleNode': () => `${id}[${label}]`,
      'ScatterNode': (sp) => {
        if (sp.execution !== undefined && sp.execution.mode === 'reservoir') {
          // Reservoir-configured scatter: augment label with key/capacity marker.
          // Per-key fill and per-firing batch size are runtime values — the
          // animation layer renders them from observer buffer-size deltas.
          const reservoirLabel = MermaidRenderer.label(
            `${displayLabel}\\n▣ ${sp.execution.reservoir.keyField} ×${sp.execution.reservoir.capacity}`,
          );
          return `${id}[/${reservoirLabel}/]`;
        }
        // Plain scatter (no reservoir): trapezoid shape.
        return `${id}[/${label}/]`;
      },
      'EmbeddedDAGNode': () => `${id}[[${label}]]`,
      'GatherNode': () => `${id}{${label}}`,
      'TerminalNode': (tp) => {
        const outcomeLabel = MermaidRenderer.label(`${displayLabel}\\n(${tp.outcome})`);
        if (tp.outcome === 'completed') {
          // double-circle: connotes "final state" in Mermaid
          return `${id}(((${outcomeLabel})))`;
        }
        // asymmetric / flag shape for failed terminals
        return `${id}>${outcomeLabel}]`;
      },
      'PhaseNode': (pp) => {
        // stadium shape: connotes a lifecycle hook (pre/post) wrapping a node
        return `${id}([${MermaidRenderer.label(`${displayLabel} (${pp.phase})`)}])`;
      },
    };
    return PlacementUtils.invoke(shapeDispatch, placement);
  }

  /** Render a placement's outbound edges as `from -->|label| to` lines. */
  private static renderEdges(
    placement: PlacementEntryType,
    id: string,
    ids: ReadonlyMap<string, string>,
    sanitize: boolean,
  ): readonly string[] {
    // TerminalNode placements are leaf placements; they have no outputs field.
    if (!('outputs' in placement)) return [];
    const lines: string[] = [];
    for (const [outputName, target] of Object.entries(placement.outputs)) {
      const labelText = MermaidRenderer.escapeLabel(outputName);
      lines.push(`  ${id} -->|${labelText}| ${MermaidRenderer.idFor(target, ids, sanitize)}`);
    }
    return lines;
  }
}
