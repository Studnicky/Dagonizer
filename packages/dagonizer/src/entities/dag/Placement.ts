/**
 * Placement: static type-guard class for DAG node placement discriminants.
 *
 * Each method narrows a `DAGNodeType` (the canonical `DAG['nodes'][number]`
 * union) to its concrete shape via the `@type` discriminant. Use instead of
 * manual `n['@type'] === '…'` checks so narrowing is consistent and refactor-
 * safe across the whole engine.
 *
 * Three-tier taxonomy: this is an **adapter contract helper** — a static
 * utility class that does not belong to any single entity but enables safe
 * narrowing across the entire placement union. It lives in `entities/dag/`
 * alongside the types it guards.
 */

import type { EmbeddedDAGNode } from './EmbeddedDAGNode.js';
import type { PhaseNodePlacementInterface } from './PhaseNode.js';
import type { ScatterNode } from './ScatterNode.js';
import type { SingleNodePlacementInterface } from './SingleNode.js';
import type { TerminalNodePlacementInterface } from './TerminalNode.js';

/** Canonical union of every node placement shape. Derived from `DAG['nodes'][number]`. */
export type DAGNodeType =
  | EmbeddedDAGNode
  | ScatterNode
  | SingleNodePlacementInterface
  | TerminalNodePlacementInterface
  | PhaseNodePlacementInterface;

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

  /** Narrows `n` to `TerminalNodePlacementInterface` when `@type === 'TerminalNode'`. */
  static isTerminal(n: DAGNodeType): n is TerminalNodePlacementInterface {
    return n['@type'] === 'TerminalNode';
  }

  /** Narrows `n` to `PhaseNodePlacementInterface` when `@type === 'PhaseNode'`. */
  static isPhase(n: DAGNodeType): n is PhaseNodePlacementInterface {
    return n['@type'] === 'PhaseNode';
  }
}
