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
 *      its sub-LayoutResultType's bounding box and lay the parent flat via dagre.
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
import type { EdgeConfig, GraphLabel } from '@dagrejs/dagre';

type DagreModule = typeof DagreDefault;

import type { DAGType } from '../entities/dag/DAG.js';

import { PlacementUtils, type CytoscapeIdModeType } from './internal.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A 2-D position for a node in the Cytoscape canvas. */
export type NodePositionType = {
  x: number;
  y: number;
}

/** Result of laying out one DAG (or sub-DAG). */
export type LayoutResultType = {
  /** Positions keyed by fully-prefixed cytoscape node id. */
  positions: ReadonlyMap<string, NodePositionType>;
  /** Total bounding-box width after layout. */
  width: number;
  /** Total bounding-box height after layout. */
  height: number;
}

/** Layout tuning knobs (all optional; sensible defaults apply). */
export type CompositeLayoutOptionsType = {
  /** Cytoscape id strategy. Default 'path' preserves call-site scoped embedded nodes. */
  idMode?: CytoscapeIdModeType;
  /** Vertical gap between ranks (dagre ranksep). Default 80. */
  rankSep?: number;
  /** Horizontal gap between sibling nodes (dagre nodesep). Default 60. */
  nodeSep?: number;
  /** Default node render width for leaf nodes. Default 180. */
  nodeWidth?: number;
  /** Default node render height for leaf nodes. Default 50. */
  nodeHeight?: number;
  /** Extra dagre reservation around embedded-DAG compounds. Default 80. */
  compoundPadding?: number;
  /** Outer dagre graph margin. Default 40. */
  margin?: number;
  /** Dagre ranking algorithm. Default 'network-simplex'. */
  ranker?: GraphLabel['ranker'];
  /** Minimum rank distance for every causal edge. Default 1. */
  edgeMinLen?: EdgeConfig['minlen'];
  /** Causal edge weight used during rank/crossing optimisation. Default 1. */
  edgeWeight?: EdgeConfig['weight'];
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type BoundingBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

type Resolved = {
  positions: Map<string, NodePositionType>;
  bb: BoundingBox;
}

// ---------------------------------------------------------------------------
// CompositeLayout
// ---------------------------------------------------------------------------

/** Bottom-up composite layout for a DAG with embedded-DAG expansion. */
export class CompositeLayout {
  private constructor() { /* static class */ }

  // dagre's graphlib types `g.node()` as a geometry-less `Label`, but after
  // `dagreLib.layout(g)` the runtime value carries `{ x, y }`. This `noun.is`
  // guard narrows that value cast-free; a missing node yields `undefined`.
  private static hasPosition(node: unknown): node is { readonly x: number; readonly y: number } {
    if (typeof node !== 'object' || node === null) return false;
    if (!('x' in node) || !('y' in node)) return false;
    return typeof node.x === 'number' && typeof node.y === 'number';
  }

  // Separation tuned so cytoscape's round-taxi edges have room to route
  // orthogonally without colliding with sibling nodes, AND so edge labels
  // (route names as mid-edge pills) don't overlap node bodies. rankSep
  // 160 / nodeSep 120 leaves a generous channel for label + arrowhead +
  // corner-radius on the round-taxi turns.
  private static readonly DEFAULT_RANK_SEP = 160;
  private static readonly DEFAULT_NODE_SEP = 120;
  private static readonly DEFAULT_NODE_WIDTH = 220;
  private static readonly DEFAULT_NODE_HEIGHT = 60;
  private static readonly DEFAULT_MARGIN = 40;
  private static readonly DEFAULT_EDGE_MIN_LEN = 1;
  private static readonly DEFAULT_EDGE_WEIGHT = 1;

  /**
   * Extra reservation added to each compound node's dagre size beyond the
   * sub-layout bounding box. Cytoscape renders a compound container border
   * that extends OUTSIDE the children's positions by the compound's CSS
   * `padding` (defaulting to 14 px in the stylesheet). Without adding this
   * buffer, sibling nodes abut the compound's visual border and overlap it
   * when dagre spaces nodes using only the raw sub-layout dimensions.
   */
  private static readonly DEFAULT_COMPOUND_PADDING = 80;

  /**
   * Compute positions for every node in `dag`, expanding embedded-DAGs
   * from `embeddedDAGs` recursively.
   *
   * Returns a `LayoutResultType` where every key is the fully-prefixed cytoscape
   * node id (matching the ids produced by `CytoscapeRenderer`).
   *
   * @dagrejs/dagre is loaded lazily on first call; the package must be
   * installed as an optional peer dependency by the consumer.
   */
  static async compute(
    dag: DAGType,
    embeddedDAGs: ReadonlyMap<string, DAGType> = new Map(),
    options: CompositeLayoutOptionsType = {},
  ): Promise<LayoutResultType> {
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
   * @param visited     Set of DAG IRIs already on the recursion stack (cycle guard).
   * @param opts        Layout tuning options.
   */
  private static layoutFlat(
    dagreLib: DagreModule,
    dag: DAGType,
    embeddedDAGs: ReadonlyMap<string, DAGType>,
    prefix: string,
    visited: ReadonlySet<string>,
    opts: CompositeLayoutOptionsType,
  ): Resolved {
    const rankSep    = opts.rankSep    ?? CompositeLayout.DEFAULT_RANK_SEP;
    const nodeSep    = opts.nodeSep    ?? CompositeLayout.DEFAULT_NODE_SEP;
    const nodeWidth  = opts.nodeWidth  ?? CompositeLayout.DEFAULT_NODE_WIDTH;
    const nodeHeight = opts.nodeHeight ?? CompositeLayout.DEFAULT_NODE_HEIGHT;
    const margin     = opts.margin     ?? CompositeLayout.DEFAULT_MARGIN;
    const compoundPadding = opts.compoundPadding ?? CompositeLayout.DEFAULT_COMPOUND_PADDING;
    const edgeMinLen = opts.edgeMinLen ?? CompositeLayout.DEFAULT_EDGE_MIN_LEN;
    const edgeWeight = opts.edgeWeight ?? CompositeLayout.DEFAULT_EDGE_WEIGHT;
    const idMode     = opts.idMode     ?? 'path';

    // ── Step 1: identify embedded-DAG sub-layouts ───────────────────────────

    // Sub-layout results for embedded-DAGs (keyed by placement IRI).
    const subLayouts = new Map<string, Resolved>();

    for (const placement of PlacementUtils.narrowNodes(dag)) {
      const dagName = PlacementUtils.embeddedDagName(placement);
      if (dagName === null) continue;
      if (visited.has(dagName)) continue;
      const body = embeddedDAGs.get(dagName);
      if (body === undefined) continue;

      const innerVisited = new Set(visited);
      innerVisited.add(dagName);
      const innerPrefix = PlacementUtils.idIn(prefix, placement['@id'], idMode);

      const sub = CompositeLayout.layoutFlat(
        dagreLib,
        body,
        embeddedDAGs,
        innerPrefix,
        innerVisited,
        opts,
      );
      subLayouts.set(placement['@id'], sub);
    }

    // ── Step 2: build the dagre graph for THIS level ───────────────────────

    const g = new dagreLib.graphlib.Graph({ "compound": false });
    g.setGraph({
      "rankdir":  'TB',
      "ranksep":  rankSep,
      "nodesep":  nodeSep,
      "marginx":  margin,
      "marginy":  margin,
      ...(opts.ranker !== undefined ? { "ranker": opts.ranker } : {}),
    });
    g.setDefaultEdgeLabel(() => ({
      "minlen": edgeMinLen,
      "weight": edgeWeight,
    }));

    // Determine node sizes and register with dagre.
    // • embedded-DAG nodes take the size of their sub-layout BB.
    // • all others use the default leaf size.
    const nodeSizes = new Map<string, { width: number; height: number }>();

    for (const placement of PlacementUtils.narrowNodes(dag)) {
      let w: number;
      let h: number;

      if (PlacementUtils.embeddedDagName(placement) !== null) {
        const sub = subLayouts.get(placement['@id']);
        if (sub !== undefined) {
          // Add compoundPadding so dagre reserves space for the
          // cytoscape compound border that extends outside the sub-layout BB,
          // preventing sibling nodes from overlapping the compound's visual box.
          w = sub.bb.width  + compoundPadding;
          h = sub.bb.height + compoundPadding;
        } else {
          w = nodeWidth;
          h = nodeHeight;
        }
      } else {
        w = nodeWidth;
        h = nodeHeight;
      }

      nodeSizes.set(placement['@id'], { "width": w, "height": h });
      const nodeId = PlacementUtils.idIn(prefix, placement['@id'], idMode);
      g.setNode(nodeId, { "width": w, "height": h });
    }

    // Register edges. All routes reference canonical placement IRIs in the DAG model.
    for (const placement of PlacementUtils.narrowNodes(dag)) {
      if (!('outputs' in placement)) continue;

      const fromId = PlacementUtils.idIn(prefix, placement['@id'], idMode);

      for (const target of Object.values(placement.outputs)) {
        const toId = PlacementUtils.idIn(prefix, target, idMode);
        if (g.hasNode(toId)) {
          g.setEdge(fromId, toId, {
            "minlen": edgeMinLen,
            "weight": edgeWeight,
          });
        }
      }
    }

    // Run dagre layout synchronously.
    dagreLib.layout(g);

    // ── Step 3: collect final positions ──────────────────────────────────

    const positions = new Map<string, NodePositionType>();

    for (const placement of PlacementUtils.narrowNodes(dag)) {
      const nodeId = PlacementUtils.idIn(prefix, placement['@id'], idMode);
      // dagre's graphlib types `g.node()` as `Label` (no geometry properties).
      // After `dagreLib.layout(g)` the runtime value carries `{x, y}`; the
      // `hasPosition` guard narrows it cast-free (and rejects missing ids).
      const dagrePos = g.node(nodeId);
      if (!CompositeLayout.hasPosition(dagrePos)) continue;

      if (PlacementUtils.embeddedDagName(placement) !== null) {
        const sub = subLayouts.get(placement['@id']);
        if (sub !== undefined) {
          // Offset all child positions so the sub-layout's center coincides
          // with the dagre-assigned center for the macro-node.
          const dx = dagrePos.x - sub.bb.centerX;
          const dy = dagrePos.y - sub.bb.centerY;
          for (const [childId, childPos] of sub.positions) {
            if (idMode === 'iri' && positions.has(childId)) continue;
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

    const bb = CompositeLayout.boundingBox(positions, nodeSizes, nodeWidth, nodeHeight, prefix, idMode);

    return { positions, bb };
  }

  /**
   * Compute a bounding box over all positions in the map.
   * Node half-dimensions are added so the BB encloses the visual node area.
   */
  private static boundingBox(
    positions: ReadonlyMap<string, NodePositionType>,
    nodeSizes: ReadonlyMap<string, { width: number; height: number }>,
    defaultW: number,
    defaultH: number,
    prefix: string,
    idMode: CytoscapeIdModeType,
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
      const localName = idMode === 'iri'
        ? id
        : prefix === '' ? id : id.slice(prefix.length + 1);
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
