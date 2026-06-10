/**
 * CompositeLayout: bottom-up composite DAG layout via @dagrejs/dagre.
 *
 * Cytoscape-dagre's compound layout is broken for embedded-DAG compounds:
 * children render in inverted order and compounds overlap predecessors.
 *
 * This class solves the problem by owning layout entirely:
 *   1. Recurse into the deepest embedded-DAG first (bottom-up).
 *   2. Lay each sub-DAG flat via dagre; record child positions + bounding box.
 *   3. At the parent level, treat each embedded-DAG as a macro-node sized to
 *      its sub-LayoutResult's bounding box and lay the parent flat via dagre.
 *   4. Composite: offset all child positions to the macro-node's dagre position.
 *
 * Final positions are applied by the caller via cytoscape's built-in preset
 * layout, which places each node at its `position` field value. Cytoscape
 * draws compound containers automatically around children given their absolute
 * positions; no compound layout plugin required.
 *
 * Static class. @dagrejs/dagre is lazily loaded on first call to `compute`.
 */

import type DagreDefault from '@dagrejs/dagre';

type DagreModule = typeof DagreDefault;

import type { DAG } from '../entities/dag/DAG.js';

import { PlacementUtils } from './internal.js';
import type { PlacementEntry } from './internal.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A 2-D position for a node in the Cytoscape canvas. */
export interface NodePosition {
  readonly x: number;
  readonly y: number;
}

/** Result of laying out one DAG (or sub-DAG). */
export interface LayoutResult {
  /** Positions keyed by fully-prefixed cytoscape node id. */
  readonly positions: ReadonlyMap<string, NodePosition>;
  /** Total bounding-box width after layout. */
  readonly width: number;
  /** Total bounding-box height after layout. */
  readonly height: number;
}

/** Layout tuning knobs (all optional; sensible defaults apply). */
export interface CompositeLayoutOptions {
  /** Vertical gap between ranks (dagre ranksep). Default 80. */
  readonly rankSep?: number;
  /** Horizontal gap between sibling nodes (dagre nodesep). Default 60. */
  readonly nodeSep?: number;
  /** Default node render width for leaf nodes. Default 180. */
  readonly nodeWidth?: number;
  /** Default node render height for leaf nodes. Default 50. */
  readonly nodeHeight?: number;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface BoundingBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly width: number;
  readonly height: number;
}

interface Resolved {
  readonly positions: Map<string, NodePosition>;
  readonly bb: BoundingBox;
}

// ---------------------------------------------------------------------------
// CompositeLayout
// ---------------------------------------------------------------------------

/** Bottom-up composite layout for a DAG with embedded-DAG expansion. */
export class CompositeLayout {
  private constructor() { /* static class */ }

  // Separation tuned so cytoscape's round-taxi edges have room to route
  // orthogonally without colliding with sibling nodes, AND so edge labels
  // (route names as mid-edge pills) don't overlap node bodies. rankSep
  // 160 / nodeSep 120 leaves a generous channel for label + arrowhead +
  // corner-radius on the round-taxi turns.
  private static readonly DEFAULT_RANK_SEP = 160;
  private static readonly DEFAULT_NODE_SEP = 120;
  private static readonly DEFAULT_NODE_WIDTH = 220;
  private static readonly DEFAULT_NODE_HEIGHT = 60;
  private static readonly MARGIN = 60;

  /**
   * Extra padding added to each compound node's dagre size beyond the
   * sub-layout bounding box. Cytoscape renders a compound container border
   * that extends OUTSIDE the children's positions by the compound's CSS
   * `padding` (defaulting to 14 px in the stylesheet). Without adding this
   * buffer, sibling nodes abut the compound's visual border and overlap it
   * when dagre spaces nodes using only the raw sub-layout dimensions.
   *
   * The value is intentionally generous (50 px per side → 100 px total per
   * axis) to account for:
   *   - cytoscape compound padding (14–22 px per side in the stylesheet)
   *   - edge arrowheads and label pills that extend outside the node body
   *   - deep nesting where the compound's border-width adds up
   */
  private static readonly COMPOUND_PADDING = 100;

  /**
   * Compute positions for every node in `dag`, expanding embedded-DAGs
   * from `embeddedDAGs` recursively.
   *
   * Returns a `LayoutResult` where every key is the fully-prefixed cytoscape
   * node id (matching the ids produced by `CytoscapeRenderer`).
   *
   * @dagrejs/dagre is loaded lazily on first call; the package must be
   * installed as an optional peer dependency by the consumer.
   */
  static async compute(
    dag: DAG,
    embeddedDAGs: ReadonlyMap<string, DAG> = new Map(),
    options: CompositeLayoutOptions = {},
  ): Promise<LayoutResult> {
    const dagreModule = (await import('@dagrejs/dagre')).default;
    const resolved = CompositeLayout.layoutFlat(
      dagreModule,
      dag,
      embeddedDAGs,
      '',
      new Set<string>([dag.name]),
      options,
    );
    return {
      "positions": resolved.positions,
      "width": resolved.bb.width,
      "height": resolved.bb.height,
    };
  }

  // ── Core recursive algorithm ─────────────────────────────────────────────

  /**
   * Layout one DAG body as a flat graph, recursing into embedded-DAGs first.
   *
   * @param dagreLib    The lazily-loaded dagre module default export.
   * @param dag         The DAG body to lay out.
   * @param embeddedDAGs Registry of registered embedded-DAG bodies.
   * @param prefix      Path prefix for cytoscape node ids (empty at root).
   * @param visited     Set of DAG names already on the recursion stack (cycle guard).
   * @param opts        Layout tuning options.
   */
  private static layoutFlat(
    dagreLib: DagreModule,
    dag: DAG,
    embeddedDAGs: ReadonlyMap<string, DAG>,
    prefix: string,
    visited: ReadonlySet<string>,
    opts: CompositeLayoutOptions,
  ): Resolved {
    const rankSep    = opts.rankSep    ?? CompositeLayout.DEFAULT_RANK_SEP;
    const nodeSep    = opts.nodeSep    ?? CompositeLayout.DEFAULT_NODE_SEP;
    const nodeWidth  = opts.nodeWidth  ?? CompositeLayout.DEFAULT_NODE_WIDTH;
    const nodeHeight = opts.nodeHeight ?? CompositeLayout.DEFAULT_NODE_HEIGHT;

    // ── Step 1: identify embedded-DAG sub-layouts ───────────────────────────

    // Sub-layout results for embedded-DAGs (keyed by placement.name).
    const subLayouts = new Map<string, Resolved>();

    for (const placement of dag.nodes as readonly PlacementEntry[]) {
      const dagName = PlacementUtils.embeddedDagName(placement);
      if (dagName === null) continue;
      if (visited.has(dagName)) continue;
      const body = embeddedDAGs.get(dagName);
      if (body === undefined) continue;

      const innerVisited = new Set(visited);
      innerVisited.add(dagName);
      const innerPrefix = PlacementUtils.idIn(prefix, placement.name);

      const sub = CompositeLayout.layoutFlat(
        dagreLib,
        body,
        embeddedDAGs,
        innerPrefix,
        innerVisited,
        opts,
      );
      subLayouts.set(placement.name, sub);
    }

    // ── Step 2: build the dagre graph for THIS level ───────────────────────

    const g = new dagreLib.graphlib.Graph({ "compound": false });
    g.setGraph({
      "rankdir":  'TB',
      "ranksep":  rankSep,
      "nodesep":  nodeSep,
      "marginx":  CompositeLayout.MARGIN,
      "marginy":  CompositeLayout.MARGIN,
    });
    g.setDefaultEdgeLabel(() => ({}));

    // Determine node sizes and register with dagre.
    // • embedded-DAG nodes take the size of their sub-layout BB.
    // • all others use the default leaf size.
    const nodeSizes = new Map<string, { width: number; height: number }>();

    for (const placement of dag.nodes as readonly PlacementEntry[]) {
      let w: number;
      let h: number;

      if (PlacementUtils.embeddedDagName(placement) !== null) {
        const sub = subLayouts.get(placement.name);
        if (sub !== undefined) {
          // Add COMPOUND_PADDING to each side so dagre reserves space for the
          // cytoscape compound border that extends outside the sub-layout BB,
          // preventing sibling nodes from overlapping the compound's visual box.
          w = sub.bb.width  + CompositeLayout.COMPOUND_PADDING;
          h = sub.bb.height + CompositeLayout.COMPOUND_PADDING;
        } else {
          w = nodeWidth;
          h = nodeHeight;
        }
      } else {
        w = nodeWidth;
        h = nodeHeight;
      }

      nodeSizes.set(placement.name, { "width": w, "height": h });
      const nodeId = PlacementUtils.idIn(prefix, placement.name);
      g.setNode(nodeId, { "width": w, "height": h });
    }

    // Register edges. Skip null targets (terminals); no edge needed for layout.
    for (const placement of dag.nodes as readonly PlacementEntry[]) {
      if (!('outputs' in placement)) continue;

      const fromId = PlacementUtils.idIn(prefix, placement.name);

      for (const target of Object.values(placement.outputs)) {
        if (target === null) continue;                       // terminal route
        const toId = PlacementUtils.idIn(prefix, target);
        if (g.hasNode(toId)) g.setEdge(fromId, toId);
      }
    }

    // Run dagre layout synchronously.
    dagreLib.layout(g);

    // ── Step 3: collect final positions ──────────────────────────────────

    const positions = new Map<string, NodePosition>();

    for (const placement of dag.nodes as readonly PlacementEntry[]) {
      const nodeId = PlacementUtils.idIn(prefix, placement.name);
      const dagrePos = g.node(nodeId) as { x: number; y: number } | undefined;
      if (dagrePos === undefined) continue;

      if (PlacementUtils.embeddedDagName(placement) !== null) {
        const sub = subLayouts.get(placement.name);
        if (sub !== undefined) {
          // Offset all child positions so the sub-layout's center coincides
          // with the dagre-assigned center for the macro-node.
          const dx = dagrePos.x - sub.bb.centerX;
          const dy = dagrePos.y - sub.bb.centerY;
          for (const [childId, childPos] of sub.positions) {
            positions.set(childId, { "x": childPos.x + dx, "y": childPos.y + dy });
          }
          // The compound node itself sits at the dagre center.
          positions.set(nodeId, { "x": dagrePos.x, "y": dagrePos.y });
          continue;
        }
        // Fallthrough: embedded-dag body not registered → treat as leaf.
      }

      // Regular leaf or unresolved embedded-dag.
      positions.set(nodeId, { "x": dagrePos.x, "y": dagrePos.y });
    }

    // ── Step 4: compute bounding box ────────────────────────────────────

    const bb = CompositeLayout.boundingBox(positions, nodeSizes, nodeWidth, nodeHeight, prefix);

    return { positions, bb };
  }

  /**
   * Compute a bounding box over all positions in the map.
   * Node half-dimensions are added so the BB encloses the visual node area.
   */
  private static boundingBox(
    positions: ReadonlyMap<string, NodePosition>,
    nodeSizes: ReadonlyMap<string, { width: number; height: number }>,
    defaultW: number,
    defaultH: number,
    prefix: string,
  ): BoundingBox {
    if (positions.size === 0) {
      return { "minX": 0, "minY": 0, "maxX": defaultW, "maxY": defaultH, "centerX": defaultW / 2, "centerY": defaultH / 2, "width": defaultW, "height": defaultH };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const [id, pos] of positions) {
      // Try to look up node size by un-prefixing the last segment.
      const localName = prefix === '' ? id : id.slice(prefix.length + 1);
      const size = nodeSizes.get(localName);
      const hw = (size?.width  ?? defaultW) / 2;
      const hh = (size?.height ?? defaultH) / 2;

      if (pos.x - hw < minX) minX = pos.x - hw;
      if (pos.y - hh < minY) minY = pos.y - hh;
      if (pos.x + hw > maxX) maxX = pos.x + hw;
      if (pos.y + hh > maxY) maxY = pos.y + hh;
    }

    const width   = maxX - minX;
    const height  = maxY - minY;
    const centerX = minX + width / 2;
    const centerY = minY + height / 2;

    return { minX, minY, maxX, maxY, centerX, centerY, width, height };
  }
}
