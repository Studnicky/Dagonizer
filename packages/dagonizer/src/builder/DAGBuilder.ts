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
import type { GatherConfig } from '../entities/dag/GatherConfig.js';
import type { ParallelNode } from '../entities/dag/ParallelNode.js';
import type { PhaseNodePlacementInterface } from '../entities/dag/PhaseNode.js';
import type { ScatterNode } from '../entities/dag/ScatterNode.js';
import type { SingleNodePlacementInterface } from '../entities/dag/SingleNode.js';
import type { TerminalNodePlacementInterface } from '../entities/dag/TerminalNode.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

import type { Path } from './Path.js';

type DAGNodeType = ScatterNode | ParallelNode | SingleNodePlacementInterface | TerminalNodePlacementInterface | PhaseNodePlacementInterface;

/**
 * Resolves to `Path<T>` when `T` is a concrete subtype of `NodeStateInterface`
 * (i.e. the caller passed an explicit `TState`); resolves to `string`
 * when `T = NodeStateInterface` (the default). This keeps existing call sites
 * backward-compatible — the parent path stays `string` so arbitrary dotted
 * strings continue to typecheck.
 */
type ParentPath<T extends NodeStateInterface> =
  NodeStateInterface extends T ? string : Path<T>;

/**
 * Optional configuration for a scatter node added via `DAGBuilder.scatter`.
 *
 * `TState` narrows `projection` values and `gather.mapping` values to dotted
 * paths that exist on the state when a concrete subtype is passed.
 */
export interface ScatterOptionsInterface<TState extends NodeStateInterface = NodeStateInterface> {
  /** State-array path to fan out over. Absent ⇒ one clone (singleton). */
  readonly source?: string;
  /** Metadata key under which each item is written per clone. Defaults to `currentItem`. */
  readonly itemKey?: string;
  /** Maximum number of clones run concurrently. Defaults to item count. */
  readonly concurrency?: number;
  /**
   * Parent → clone field projection before the body runs.
   * Keys are clone paths; values are parent paths (narrowed to `Path<TState>`
   * when `TState` is a concrete subtype).
   */
  readonly projection?: Partial<Record<string, ParentPath<TState>>>;
  /** Gather config — how produced clone state merges back into the parent. */
  readonly gather?: GatherConfig;
  /** Outcome reducer name. Defaults to `'aggregate'` with source, `'terminal'` without. */
  readonly reducer?: string;
}

/**
 * Chainable authoring API that builds a `DAG` in JSON-LD canonical form.
 *
 * Each node placement is assigned:
 *   - `@id`:   `urn:noocodex:dag:<dagName>/node/<placementName>`
 *   - `@type`: the RDF class name (`'SingleNode'`, `'ParallelNode'`, `'ScatterNode'`, etc.)
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

  /**
   * Append a scatter node. A scatter isolates a state clone per source item
   * (or exactly one clone when `source` is absent), runs a body (registered
   * node or registered sub-DAG) in the clone, and routes on the aggregate
   * outcome.
   *
   * When `body` is a `NodeInterface` the impl is registered automatically and
   * the placement emits `body: { node: body.name }`. When `body` is
   * `{ dag: string }` no impl is registered and the placement emits
   * `body: { dag }`.
   *
   * Supply `TState` to narrow `options.projection` values and
   * `options.gather.mapping` values to dotted paths on the state.
   *
   * @example
   * ```ts
   * builder.scatter('generate', generateNode,
   *   { 'all-success': 'select', 'partial': 'select', 'all-error': null, 'empty': null },
   *   { source: 'providers', gather: { strategy: 'map', mapping: { candidate: 'candidates' } } },
   * );
   * ```
   */
  scatter<TState extends NodeStateInterface, TOutput extends string, TServices = undefined>(
    name: string,
    body: NodeInterface<TState, TOutput, TServices> | { readonly dag: string },
    outputs: Record<string, null | string>,
    options: ScatterOptionsInterface<TState> = {},
  ): this {
    const scatterNode: ScatterNode = {
      '@id':     this.#nodeId(name),
      '@type':   'ScatterNode',
      name,
      'body':    'dag' in body ? { 'dag': body.dag } : { 'node': (body as NodeInterface<TState, TOutput, TServices>).name },
      'outputs': outputs,
    };
    if (options.source !== undefined) scatterNode.source = options.source;
    if (options.itemKey !== undefined) scatterNode.itemKey = options.itemKey;
    if (options.concurrency !== undefined) scatterNode.concurrency = options.concurrency;
    if (options.projection !== undefined) scatterNode.projection = options.projection as Record<string, string>;
    if (options.gather !== undefined) scatterNode.gather = options.gather;
    if (options.reducer !== undefined) scatterNode.reducer = options.reducer;

    if (!('dag' in body)) {
      this.#nodeImpls.set(name, body as NodeInterface);
    }

    this.#nodes.push(scatterNode);
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
   * or `.parallel()` — which do not receive a `NodeInterface` — are not tracked
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
      'nodes':      [...this.#nodes] as DAG['nodes'],
    };

    // Run contract validation for the subset of placements registered via
    // .node() / .scatter() whose underlying NodeInterface carries a contract.
    // Placements added via .parallel() are not in #nodeImpls and
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
   * manual placement (fan-out, terminals, embedded-DAGs).
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
