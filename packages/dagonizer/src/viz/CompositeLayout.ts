/**
 * CompositeLayout — bottom-up composite DAG layout via @dagrejs/dagre.
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
 *   5. For parallel placements: lay children horizontally in a single rank,
 *      then anchor the parallel node to their bounding box center.
 *
 * Final positions are applied by the caller via cytoscape's built-in preset
 * layout, which places each node at its `position` field value. Cytoscape
 * draws compound containers automatically around children given their absolute
 * positions — no compound layout plugin required.
 *
 * Static class. Synchronous.
 */

import dagre from '@dagrejs/dagre';

import type { DAG } from '../entities/dag/DAG.js';
import type { EmbeddedDAGNode } from '../entities/dag/EmbeddedDAGNode.js';
import type { FanOutNode } from '../entities/dag/FanOutNode.js';
import type { ParallelNode } from '../entities/dag/ParallelNode.js';
import type { SingleNodePlacementInterface } from '../entities/dag/SingleNode.js';
import type { TerminalNodePlacementInterface } from '../entities/dag/TerminalNode.js';

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

/** Layout tuning knobs — all optional, sensible defaults apply. */
export interface CompositeLayoutOptions {
  /** Vertical gap between ranks (dagre ranksep). Default 80. */
  readonly rankSep?: number;
  /** Horizontal gap between sibling nodes (dagre nodesep). Default 60. */
  readonly nodeSep?: number;
  /** Default node render width for leaf nodes. Default 180. */
  readonly nodeWidth?: number;
  /** Default node render height for leaf nodes. Default 50. */
  readonly nodeHeight?: number;
  /**
   * Horizontal gap between parallel siblings.
   * Defaults to `nodeSep ?? 60`.
   */
  readonly parallelNodeSep?: number;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type DAGNodeEntry =
  | FanOutNode
  | ParallelNode
  | SingleNodePlacementInterface
  | EmbeddedDAGNode
  | TerminalNodePlacementInterface;

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

  private static readonly DEFAULT_RANK_SEP = 80;
  private static readonly DEFAULT_NODE_SEP = 60;
  private static readonly DEFAULT_NODE_WIDTH = 180;
  private static readonly DEFAULT_NODE_HEIGHT = 50;
  private static readonly MARGIN = 40;

  /**
   * Compute positions for every node in `dag`, expanding embedded-DAGs
   * from `embeddedDAGs` recursively.
   *
   * Returns a `LayoutResult` where every key is the fully-prefixed cytoscape
   * node id (matching the ids produced by `CytoscapeRenderer`).
   */
  static compute(
    dag: DAG,
    embeddedDAGs: ReadonlyMap<string, DAG> = new Map(),
    options: CompositeLayoutOptions = {},
  ): LayoutResult {
    const resolved = CompositeLayout.layoutFlat(
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
   * @param dag         The DAG body to lay out.
   * @param embeddedDAGs Registry of registered embedded-DAG bodies.
   * @param prefix      Path prefix for cytoscape node ids (empty at root).
   * @param visited     Set of DAG names already on the recursion stack (cycle guard).
   * @param opts        Layout tuning options.
   */
  private static layoutFlat(
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
    const parallelSep = opts.parallelNodeSep ?? nodeSep;

    // ── Step 1: identify parallel children, embedded-DAG sub-layouts ─────

    // Parallel children are rendered inside their parent compound. We'll lay
    // them out horizontally and treat the parallel node's dagre slot as their
    // collective bounding box.
    const parallelChildren = new Set<string>();
    const parallelChildLists = new Map<string, readonly string[]>();
    for (const placement of dag.nodes as readonly DAGNodeEntry[]) {
      if (placement['@type'] === 'ParallelNode') {
        for (const child of placement.nodes) parallelChildren.add(child);
        parallelChildLists.set(placement.name, placement.nodes);
      }
    }

    // Sub-layout results for embedded-DAGs (keyed by placement.name).
    const subLayouts = new Map<string, Resolved>();

    for (const placement of dag.nodes as readonly DAGNodeEntry[]) {
      if (placement['@type'] !== 'EmbeddedDAGNode') continue;
      if (visited.has(placement.dag)) continue;
      const body = embeddedDAGs.get(placement.dag);
      if (body === undefined) continue;

      const innerVisited = new Set(visited);
      innerVisited.add(placement.dag);
      const innerPrefix = CompositeLayout.idIn(prefix, placement.name);

      const sub = CompositeLayout.layoutFlat(
        body,
        embeddedDAGs,
        innerPrefix,
        innerVisited,
        opts,
      );
      subLayouts.set(placement.name, sub);
    }

    // ── Step 2: build the dagre graph for THIS level ───────────────────────

    const g = new dagre.graphlib.Graph({ "compound": false });
    g.setGraph({
      "rankdir":  'TB',
      "ranksep":  rankSep,
      "nodesep":  nodeSep,
      "marginx":  CompositeLayout.MARGIN,
      "marginy":  CompositeLayout.MARGIN,
    });
    g.setDefaultEdgeLabel(() => ({}));

    // Determine node sizes and register with dagre.
    // • parallel children are SKIPPED at this level (they get their own
    //   horizontal mini-layout applied after dagre positions the parallel slot).
    // • parallel nodes take the size of their collective children BB.
    // • embedded-DAG nodes take the size of their sub-layout BB.
    // • all others use the default leaf size.
    const nodeSizes = new Map<string, { width: number; height: number }>();

    for (const placement of dag.nodes as readonly DAGNodeEntry[]) {
      if (parallelChildren.has(placement.name)) continue; // handled inside parallel slot

      let w: number;
      let h: number;

      if (placement['@type'] === 'EmbeddedDAGNode') {
        const sub = subLayouts.get(placement.name);
        if (sub !== undefined) {
          w = sub.bb.width;
          h = sub.bb.height;
        } else {
          w = nodeWidth;
          h = nodeHeight;
        }
      } else if (placement['@type'] === 'ParallelNode') {
        const children = parallelChildLists.get(placement.name) ?? [];
        // Horizontal strip: all children at same height, distributed with gap.
        const stripW = children.length * nodeWidth + Math.max(0, children.length - 1) * parallelSep;
        const stripH = nodeHeight;
        w = stripW + CompositeLayout.MARGIN * 2;
        h = stripH + CompositeLayout.MARGIN * 2;
      } else {
        w = nodeWidth;
        h = nodeHeight;
      }

      nodeSizes.set(placement.name, { "width": w, "height": h });
      const nodeId = CompositeLayout.idIn(prefix, placement.name);
      g.setNode(nodeId, { "width": w, "height": h });
    }

    // Register edges. Skip null targets (terminals) — no edge needed for layout.
    // Also skip edges to/from parallel children (they're inside the compound).
    for (const placement of dag.nodes as readonly DAGNodeEntry[]) {
      if (parallelChildren.has(placement.name)) continue;
      if (!('outputs' in placement)) continue;

      const fromId = CompositeLayout.idIn(prefix, placement.name);

      for (const target of Object.values(placement.outputs)) {
        if (target === null) continue;                       // terminal route
        if (parallelChildren.has(target)) continue;          // child is inside parallel
        const toId = CompositeLayout.idIn(prefix, target);
        if (g.hasNode(toId)) g.setEdge(fromId, toId);
      }
    }

    // Run dagre layout synchronously.
    dagre.layout(g);

    // ── Step 3: collect final positions ──────────────────────────────────

    const positions = new Map<string, NodePosition>();

    for (const placement of dag.nodes as readonly DAGNodeEntry[]) {
      if (parallelChildren.has(placement.name)) continue;

      const nodeId = CompositeLayout.idIn(prefix, placement.name);
      const dagrePos = g.node(nodeId) as { x: number; y: number } | undefined;
      if (dagrePos === undefined) continue;

      if (placement['@type'] === 'EmbeddedDAGNode') {
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

      if (placement['@type'] === 'ParallelNode') {
        // Position the parallel compound node itself.
        positions.set(nodeId, { "x": dagrePos.x, "y": dagrePos.y });

        // Distribute parallel children horizontally inside the compound slot.
        const children = parallelChildLists.get(placement.name) ?? [];
        const totalW = children.length * nodeWidth + Math.max(0, children.length - 1) * parallelSep;
        const startX = dagrePos.x - totalW / 2 + nodeWidth / 2;
        for (let i = 0; i < children.length; i++) {
          const childName = children[i];
          if (childName === undefined) continue;
          const childId = CompositeLayout.idIn(prefix, childName);
          const cx = startX + i * (nodeWidth + parallelSep);
          const cy = dagrePos.y;
          positions.set(childId, { "x": cx, "y": cy });
        }
        continue;
      }

      // Regular leaf or unresolved embedded-dag.
      positions.set(nodeId, { "x": dagrePos.x, "y": dagrePos.y });
    }

    // ── Step 4: compute bounding box ────────────────────────────────────

    const bb = CompositeLayout.boundingBox(positions, nodeSizes, nodeWidth, nodeHeight, prefix);

    return { positions, bb };
  }

  // ── Utilities ────────────────────────────────────────────────────────────

  /** Build a placement-name id, optionally prefixed by an enclosing scope. */
  private static idIn(prefix: string, name: string): string {
    return prefix === '' ? name : `${prefix}/${name}`;
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
