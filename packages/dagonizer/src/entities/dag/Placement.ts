/**
 * Placement: static type-guard class for DAG node placement discriminants.
 *
 * Each method narrows a `DAGNodeType` (the canonical `DAG['nodes'][number]`
 * union) to its concrete shape via the `@type` discriminant. Use instead of
 * manual `n['@type'] === '…'` checks so narrowing is consistent and refactor-
 * safe across the whole engine.
 *
 * Domain utility co-located with the entity types it guards. Lives in
 * `entities/dag/` alongside `SingleNode`, `ScatterNode`, `EmbeddedDAGNode`,
 * `TerminalNode`, and `PhaseNode` — the placement shapes it narrows.
 */

import type { EmbeddedDAGNode } from './EmbeddedDAGNode.js';
import type { PhaseNode } from './PhaseNode.js';
import type { ScatterNode } from './ScatterNode.js';
import type { SingleNodePlacementInterface } from './SingleNode.js';
import type { TerminalNode } from './TerminalNode.js';

/** Canonical union of every node placement shape. Derived from `DAG['nodes'][number]`. */
export type DAGNodeType =
  | EmbeddedDAGNode
  | ScatterNode
  | SingleNodePlacementInterface
  | TerminalNode
  | PhaseNode;

/**
 * Static type-guard class for DAG node placement discriminants.
 *
 * Each method narrows a `DAGNodeType` to its concrete shape via the `@type`
 * discriminant. Preferred over raw `n['@type'] === '…'` comparisons so
 * every narrowing site is consistent.
 */
export class Placement {
  private constructor() { /* static class */ }

  /** Narrows `n` to `EmbeddedDAGNode` when `@type === 'EmbeddedDAGNode'`. */
  static isEmbeddedDAG(n: DAGNodeType): n is EmbeddedDAGNode {
    return n['@type'] === 'EmbeddedDAGNode';
  }

  /** Narrows `n` to `ScatterNode` when `@type === 'ScatterNode'`. */
  static isScatter(n: DAGNodeType): n is ScatterNode {
    return n['@type'] === 'ScatterNode';
  }

  /** Narrows `n` to `SingleNodePlacementInterface` when `@type === 'SingleNode'`. */
  static isSingle(n: DAGNodeType): n is SingleNodePlacementInterface {
    return n['@type'] === 'SingleNode';
  }

  /** Narrows `n` to `TerminalNode` when `@type === 'TerminalNode'`. */
  static isTerminal(n: DAGNodeType): n is TerminalNode {
    return n['@type'] === 'TerminalNode';
  }

  /** Narrows `n` to `PhaseNode` when `@type === 'PhaseNode'`. */
  static isPhase(n: DAGNodeType): n is PhaseNode {
    return n['@type'] === 'PhaseNode';
  }
}
