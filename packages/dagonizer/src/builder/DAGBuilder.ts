/**
 * DAGBuilder — chainable authoring API for `DAG`.
 *
 * Builds a JSON-LD canonical `DAG` document. Each node placement receives
 * `@id` (a URN scoped under the DAG name) and `@type` (the RDF class name).
 * The returned object from `build()` satisfies `DAGSchema` and can be passed
 * directly to `dispatcher.registerDAG(dag)`.
 *
 * Cross-ref: the RDF builder in `semantics/` workspace — same shape, same
 * chainable surface, output is plain data.
 *
 * Subclass to extend the builder; methods preserve `this` for fluent chaining.
 */

import type { NodeInterface } from '../contracts/NodeInterface.js';
import { ContractRegistryValidator } from '../derive/ContractRegistryValidator.js';
import { DAGDeriver } from '../derive/DAGDeriver.js';
import type { DAGDeriverAnnotations } from '../derive/DAGDeriverAnnotations.js';
import type { DAG } from '../entities/dag/DAG.js';
import { DAG_CONTEXT } from '../entities/dag/DAG.js';
import type { DeepDAGNode } from '../entities/dag/DeepDAGNode.js';
import type { FanInConfig } from '../entities/dag/FanInConfig.js';
import type { FanOutNode } from '../entities/dag/FanOutNode.js';
import type { ParallelNode } from '../entities/dag/ParallelNode.js';
import type { PhaseNodePlacementInterface } from '../entities/dag/PhaseNode.js';
import type { SingleNodePlacementInterface } from '../entities/dag/SingleNode.js';
import type { TerminalNodePlacementInterface } from '../entities/dag/TerminalNode.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

import type { Path } from './Path.js';

type DAGNodeType = FanOutNode | ParallelNode | SingleNodePlacementInterface | DeepDAGNode | TerminalNodePlacementInterface | PhaseNodePlacementInterface;

/** Optional configuration for a fan-out node added via `DAGBuilder.fanOut`. */
export interface FanOutOptionsInterface {
  /** Maximum number of items processed concurrently. Defaults to the full source array length. */
  'concurrency'?: number;
  /** Metadata key under which each item is written for the node to read. Defaults to `currentItem`. */
  'itemKey'?: string;
}

/** Optional configuration for a deep-DAG node added via `DAGBuilder.deepDAG`. */
export interface DeepDAGOptionsInterface {
  /**
   * State mapping between parent and child DAGs. `input` copies fields from the
   * parent node state into the child node state before the deep-DAG runs;
   * `output` copies fields from the child node state back into the parent after
   * it completes.
   */
  'stateMapping'?: {
    'input'?: Record<string, string>;
    'output'?: Record<string, string>;
  };
}

/**
 * Typed deep-DAG options. Both generics narrow path strings at compile time:
 * `TChildState` narrows the LEFT side of `inputs` and the RIGHT side of
 * `outputs` to keys / dotted paths that exist on the child state. `TParentState`
 * narrows the RIGHT side of `inputs` and BOTH sides of `outputs` to dotted
 * paths that exist on the parent state.
 *
 * Defaults to `NodeStateInterface` for both generics so existing call sites
 * that pass neither generic continue to typecheck.
 *
 * @example
 * ```ts
 * class ParentState extends NodeStateBase {
 *   user = { name: '', age: 0 };
 * }
 * class ChildState extends NodeStateBase {
 *   payload = '';
 *   result  = 0;
 * }
 *
 * builder.deepDAG<ChildState, ParentState>('invoke', 'child-dag', routes, {
 *   inputs:  { payload: 'user.name' },     // 'payload' ∈ ChildState; 'user.name' ∈ Path<ParentState>
 *   outputs: { 'user.age': 'result' },     // 'user.age' ∈ Path<ParentState>; 'result' ∈ Path<ChildState>
 * });
 * ```
 */
/**
 * Resolves to `Path<T>` when `T` is a concrete subtype of `NodeStateInterface`
 * (i.e. the caller passed an explicit `TParentState`); resolves to `string`
 * when `T = NodeStateInterface` (the default). This keeps existing call sites
 * that pass only `TChildState` backward-compatible — the parent path stays
 * `string` so arbitrary dotted strings continue to typecheck.
 *
 * The check `NodeStateInterface extends T` is true only when `T` is
 * `NodeStateInterface` itself (or a supertype), not when `T` is a concrete
 * subclass. A concrete subclass has extra properties, so
 * `NodeStateInterface extends ConcreteState` is false.
 */
type ParentPath<T extends NodeStateInterface> =
  NodeStateInterface extends T ? string : Path<T>;

export interface TypedDeepDAGOptionsInterface<
  TChildState extends NodeStateInterface = NodeStateInterface,
  TParentState extends NodeStateInterface = NodeStateInterface,
> {
  /**
   * Input mapping: child-state key → parent-state dotted path.
   * Child key is narrowed to `keyof TChildState & string`.
   * Parent path is narrowed to `Path<TParentState>` when `TParentState` is
   * a concrete subtype; falls back to `string` when using the default
   * `NodeStateInterface` (preserving backward compatibility).
   * Before the deep-DAG runs, each listed parent field is copied into the
   * corresponding child field.
   */
  readonly 'inputs'?:  Partial<Record<keyof TChildState & string, ParentPath<TParentState>>>;

  /**
   * Output mapping: parent-state dotted path → child-state dotted path.
   * Parent key is narrowed to `Path<TParentState>` (falls back to `string`
   * when using the default); child path is narrowed to `Path<TChildState>`
   * (falls back to `string` when using the default).
   * After the deep-DAG completes, each listed child field is copied back into
   * the corresponding parent field.
   */
  readonly 'outputs'?: Partial<Record<ParentPath<TParentState>, ParentPath<TChildState>>>;
}

/**
 * Chainable authoring API that builds a `DAG` in JSON-LD canonical form.
 *
 * Each node placement is assigned:
 *   - `@id`:   `urn:noocodex:dag:<dagName>/node/<placementName>`
 *   - `@type`: the RDF class name (`'SingleNode'`, `'ParallelNode'`, etc.)
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
  readonly #nodeImpls: Map<string, NodeInterface> = new Map();
  #entrypoint: string | null = null;

  constructor(name: string, version: string) {
    this.#name = name;
    this.#version = version;
  }

  /** Compute the placement `@id` URN. */
  #nodeId(placementName: string): string {
    return `urn:noocodex:dag:${this.#name}/node/${placementName}`;
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
      '@id':     this.#nodeId(name),
      '@type':   'SingleNode',
      name,
      'node':    dagNode.name,
      'outputs': routes as Record<string, null | string>,
    });
    this.#nodeImpls.set(name, dagNode as NodeInterface);
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
      '@id':     this.#nodeId(name),
      '@type':   'ParallelNode',
      name,
      'nodes':   [...nodes],
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
      '@id':     this.#nodeId(name),
      '@type':   'FanOutNode',
      name,
      'node':    dagNode.name,
      source,
      fanIn,
      'outputs': routes,
    };
    if (options.concurrency !== undefined) dagNodeEntry.concurrency = options.concurrency;
    if (options.itemKey !== undefined) dagNodeEntry.itemKey = options.itemKey;
    this.#nodes.push(dagNodeEntry);
    this.#nodeImpls.set(name, dagNode as NodeInterface);
    if (this.#entrypoint === null) this.#entrypoint = name;
    return this;
  }

  /**
   * Append a deep-DAG node. `routes` covers `success | error`.
   *
   * Supply `TChildState` to narrow the LEFT side of `inputs` and the RIGHT
   * side of `outputs` to keys / dotted paths that exist on the child state.
   * Supply `TParentState` to narrow the RIGHT side of `inputs` and BOTH sides
   * of `outputs` to dotted paths that exist on the parent state.
   *
   * Both generics default to `NodeStateInterface`, so existing call sites
   * that pass neither generic continue to typecheck unchanged.
   *
   * @example
   * ```ts
   * builder.deepDAG<ChildState, ParentState>('invoke', 'child-dag',
   *   { success: 'next', error: null },
   *   { inputs: { payload: 'user.name' }, outputs: { 'user.age': 'result' } },
   * );
   * ```
   */
  deepDAG<
    TChildState extends NodeStateInterface = NodeStateInterface,
    TParentState extends NodeStateInterface = NodeStateInterface,
  >(
    name: string,
    dagName: string,
    routes: Record<'success' | 'error', null | string>,
    options: TypedDeepDAGOptionsInterface<TChildState, TParentState> = {},
  ): this {
    const dagNode: DeepDAGNode = {
      '@id':   this.#nodeId(name),
      '@type': 'DeepDAGNode',
      name,
      'dag':   dagName,
      'outputs': routes,
    };
    if (options.inputs !== undefined || options.outputs !== undefined) {
      const stateMapping: DeepDAGNode['stateMapping'] = {};
      if (options.inputs  !== undefined) stateMapping.input  = options.inputs  as Record<string, string>;
      if (options.outputs !== undefined) stateMapping.output = options.outputs as Record<string, string>;
      dagNode.stateMapping = stateMapping;
    }
    this.#nodes.push(dagNode);
    if (this.#entrypoint === null) this.#entrypoint = name;
    return this;
  }

  /**
   * Append a terminal node. When reached, the flow ends with the given
   * `outcome`. `'completed'` is the default — the flow resolves cleanly.
   * `'failed'` marks the state as failed before resolving.
   *
   * TerminalNodes have no routing (`outputs` map). They are placement-only
   * constructs with no backing `NodeInterface`.
   */
  terminal(name: string, outcome: 'completed' | 'failed' = 'completed'): this {
    const placement: TerminalNodePlacementInterface = {
      '@id':   this.#nodeId(name),
      '@type': 'TerminalNode',
      name,
      outcome,
    };
    this.#nodes.push(placement);
    if (this.#entrypoint === null) this.#entrypoint = name;
    return this;
  }

  /**
   * Append a lifecycle-attached phase placement. `phase: 'pre'` runs before
   * the entrypoint in DAG declaration order; an error aborts the run.
   * `phase: 'post'` runs after the main loop drains on every exit path
   * (completion, abort, timeout, terminal-failed, node throw); errors are
   * collected as warnings on state and do not change the already-set
   * lifecycle.
   *
   * Phase placements are out-of-band — they have no `outputs`, never the
   * main-loop entrypoint, and never route to other placements.
   */
  phase<TState extends NodeStateInterface, TOutput extends string, TServices = undefined>(
    name: string,
    phase: 'pre' | 'post',
    dagNode: NodeInterface<TState, TOutput, TServices>,
  ): this {
    const placement: PhaseNodePlacementInterface = {
      '@id':   this.#nodeId(name),
      '@type': 'PhaseNode',
      name,
      'node':  dagNode.name,
      phase,
    };
    this.#nodes.push(placement);
    this.#nodeImpls.set(name, dagNode as NodeInterface);
    // Intentionally does NOT set entrypoint — phase placements are
    // out-of-band and never the main-loop entry.
    return this;
  }

  /**
   * Materialize the accumulated nodes into a canonical JSON-LD `DAG` document.
   *
   * When any placement registered via `.node()` or `.fanOut()` carries a
   * `contract` on its underlying `NodeInterface`, `build()` runs the same
   * dangling-read / dead-write validation that `DAGDeriver` runs at derive
   * time. Dangling reads throw `DAGError`; dead writes are routed to
   * `onContractWarning` (no-op if omitted). Placements added via `.parallel()`
   * or `.deepDAG()` — which do not receive a `NodeInterface` — are not tracked
   * in the impl registry and are silently skipped during contract validation;
   * this prevents false-positive dangling-read errors for node names that are
   * declared elsewhere.
   *
   * @param onContractWarning - Optional callback for dead-write warnings. If
   *   omitted, dead writes are silently no-oped. Dangling reads always throw.
   */
  build(onContractWarning?: (message: string) => void): DAG {
    if (this.#entrypoint === null) {
      throw new Error(`DAGBuilder('${this.#name}'): cannot build DAG without an entrypoint — call .entrypoint() or add at least one node first`);
    }
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      `urn:noocodex:dag:${this.#name}`,
      '@type':    'DAG',
      'name':       this.#name,
      'version':    this.#version,
      'entrypoint': this.#entrypoint,
      'nodes':      [...this.#nodes],
    };

    // Run contract validation for the subset of placements registered via
    // .node() / .fanOut() whose underlying NodeInterface carries a contract.
    // Placements added via .parallel() / .deepDAG() are not in #nodeImpls and
    // are intentionally skipped — no false-positive dangling-read errors.
    const contractNodes = [...this.#nodeImpls.values()].filter(
      (impl) => impl.contract !== undefined,
    );
    if (contractNodes.length > 0) {
      const contracts = DAGDeriver.extractContracts(contractNodes);
      ContractRegistryValidator.validate(
        contracts,
        onContractWarning ?? (() => { /* no-op */ }),
        this.#entrypoint,
      );
    }

    return dag;
  }

  /**
   * Construct a DAG directly from a node registry — every node-with-contract
   * participates in derivation; the linear topology follows
   * produces ↔ hardRequired matching. Equivalent to calling
   * `DAGDeriver.derive({ name, version, entrypoint, nodes })` and returning
   * the resulting DAG. Use when your flow is linear and every node carries
   * a contract; drop into the fluent `.node()` API when the shape requires
   * manual placement (fan-out, terminals, deep-DAGs).
   */
  static fromNodes(opts: {
    readonly name: string;
    readonly version: string;
    readonly entrypoint: string;
    readonly nodes: readonly NodeInterface[];
    readonly annotations?: DAGDeriverAnnotations;
  }): DAG {
    const deriveOpts = opts.annotations !== undefined
      ? {
          'name':        opts.name,
          'version':     opts.version,
          'entrypoint':  opts.entrypoint,
          'nodes':       opts.nodes,
          'annotations': opts.annotations,
        }
      : {
          'name':       opts.name,
          'version':    opts.version,
          'entrypoint': opts.entrypoint,
          'nodes':      opts.nodes,
        };
    return DAGDeriver.derive(deriveOpts);
  }
}
