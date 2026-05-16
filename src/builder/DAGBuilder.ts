/**
 * DAGBuilder — chainable authoring API for `DAG`.
 *
 * Plain-object DAG configs remain the source of truth (and the form the
 * dispatcher consumes). `DAGBuilder` is a thin chainable layer that
 * accumulates nodes and returns the same plain object via `build()`.
 *
 * Cross-ref: the RDF builder in `semantics/` workspace — same shape,
 * same chainable surface, output is plain data.
 *
 * Subclass to extend the builder; methods preserve `this` for fluent
 * chaining.
 */

import type { NodeInterface } from '../contracts/NodeInterface.js';
import type { DAG } from '../entities/dag/DAG.js';
import type { FanInConfig } from '../entities/dag/FanInConfig.js';
import type { FanOutNode } from '../entities/dag/FanOutNode.js';
import type { ParallelNode } from '../entities/dag/ParallelNode.js';
import type { SingleNodePlacementInterface } from '../entities/dag/SingleNode.js';
import type { SubDAGNode } from '../entities/dag/SubDAGNode.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

type DAGNodeType = FanOutNode | ParallelNode | SingleNodePlacementInterface | SubDAGNode;

/** Optional configuration for a fan-out node added via `DAGBuilder.fanOut`. */
export interface FanOutOptionsInterface {
  /** Maximum number of items processed concurrently. Defaults to the full source array length. */
  'concurrency'?: number;
  /** Metadata key under which each item is written for the node to read. Defaults to `currentItem`. */
  'itemKey'?: string;
}

/** Optional configuration for a sub-DAG node added via `DAGBuilder.subDAG`. */
export interface SubDAGOptionsInterface {
  /**
   * State mapping between parent and child DAGs. `input` copies fields from the
   * parent node state into the child node state before the sub-DAG runs;
   * `output` copies fields from the child node state back into the parent after
   * it completes.
   */
  'stateMapping'?: {
    'input'?: Record<string, string>;
    'output'?: Record<string, string>;
  };
}

/**
 * Chainable authoring API that builds a `DAG`.
 *
 * Plain-object DAG configs remain the source of truth and the form the
 * dispatcher consumes. `DAGBuilder` is a thin layer that accumulates nodes
 * and materializes them via `build()`.
 *
 * @example
 * ```ts
 * const dag = new DAGBuilder('pipeline', '1.0')
 *   .node('validate', validateNode, { valid: 'process', invalid: null })
 *   .node('process',  processNode,  { success: null, error: null })
 *   .build();
 *
 * dispatcher.registerDAG(dag);
 * ```
 */
export class DAGBuilder {
  readonly #name: string;
  readonly #version: string;
  readonly #nodes: DAGNodeType[] = [];
  #entrypoint: string | null = null;

  constructor(name: string, version: string) {
    this.#name = name;
    this.#version = version;
  }

  /** Set (or override) the entrypoint node name. */
  entrypoint(nodeName: string): this {
    this.#entrypoint = nodeName;
    return this;
  }

  /**
   * Append a single node. The node's `TOutput` parameter
   * narrows `routes`, forcing exhaustive routing at compile time.
   */
  node<TState extends NodeStateInterface, TOutput extends string, TServices = undefined>(
    name: string,
    dagNode: NodeInterface<TState, TOutput, TServices>,
    routes: Record<TOutput, null | string>,
  ): this {
    this.#nodes.push({
      'type': 'single',
      name,
      'node': dagNode.name,
      'outputs': routes as Record<string, null | string>,
    });
    if (this.#entrypoint === null) this.#entrypoint = name;
    return this;
  }

  /** Append a parallel group of previously-declared single nodes. */
  parallel(
    name: string,
    nodes: readonly string[],
    combine: ParallelNode['combine'],
    routes: Record<string, null | string>,
  ): this {
    this.#nodes.push({
      'type': 'parallel',
      name,
      'nodes': [...nodes],
      combine,
      'outputs': routes,
    });
    if (this.#entrypoint === null) this.#entrypoint = name;
    return this;
  }

  /** Append a fan-out node. `routes` covers `all-success | partial | all-error | empty`. */
  fanOut<TState extends NodeStateInterface, TOutput extends string, TServices = undefined>(
    name: string,
    dagNode: NodeInterface<TState, TOutput, TServices>,
    source: string,
    fanIn: FanInConfig,
    routes: Record<'all-success' | 'partial' | 'all-error' | 'empty', null | string>,
    options: FanOutOptionsInterface = {},
  ): this {
    const dagNodeEntry: FanOutNode = {
      'type': 'fan-out',
      name,
      'node': dagNode.name,
      source,
      fanIn,
      'outputs': routes,
    };
    if (options.concurrency !== undefined) dagNodeEntry.concurrency = options.concurrency;
    if (options.itemKey !== undefined) dagNodeEntry.itemKey = options.itemKey;
    this.#nodes.push(dagNodeEntry);
    if (this.#entrypoint === null) this.#entrypoint = name;
    return this;
  }

  /** Append a sub-DAG node. `routes` covers `success | error`. */
  subDAG(
    name: string,
    dagName: string,
    routes: Record<'success' | 'error', null | string>,
    options: SubDAGOptionsInterface = {},
  ): this {
    const dagNode: SubDAGNode = {
      'type': 'sub-dag',
      name,
      'dag': dagName,
      'outputs': routes,
    };
    if (options.stateMapping !== undefined) dagNode.stateMapping = options.stateMapping;
    this.#nodes.push(dagNode);
    if (this.#entrypoint === null) this.#entrypoint = name;
    return this;
  }

  /** Materialize the accumulated nodes into a `DAG`. */
  build(): DAG {
    if (this.#entrypoint === null) {
      throw new Error(`DAGBuilder('${this.#name}'): cannot build DAG without an entrypoint — call .entrypoint() or add at least one node first`);
    }
    return {
      'name': this.#name,
      'version': this.#version,
      'entrypoint': this.#entrypoint,
      'nodes': [...this.#nodes],
    };
  }
}
