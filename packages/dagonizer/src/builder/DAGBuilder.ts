/**
 * DAGBuilder: chainable authoring API for `DAG`.
 *
 * Builds a JSON-LD canonical `DAG` document. Each node placement receives
 * `@id` (a URN scoped under the DAG name) and `@type` (the RDF class name).
 * The returned object from `build()` satisfies `DAGSchema` and can be passed
 * directly to `dispatcher.registerDAG(dag)`.
 *
 * Cross-ref: the RDF builder in `semantics/` workspace has the same shape, same
 * chainable surface, output is plain data.
 *
 * Subclass to extend the builder; methods preserve `this` for fluent chaining.
 */

import type { NodeInterface } from '../contracts/NodeInterface.js';
import type { WarningEmitter } from '../contracts/WarningEmitter.js';
import { ContractRegistryValidator } from '../derive/ContractRegistryValidator.js';
import { DAGDeriver } from '../derive/DAGDeriver.js';
import type { DAGDeriverAnnotations } from '../derive/DAGDeriverAnnotations.js';
import { DAG, DAG_CONTEXT } from '../entities/dag/DAG.js';
import type { EmbeddedDAGNode } from '../entities/dag/EmbeddedDAGNode.js';
import type { GatherConfig } from '../entities/dag/GatherConfig.js';
import type { PhaseNode } from '../entities/dag/PhaseNode.js';
import type { DAGNodeType } from '../entities/dag/Placement.js';
import type { ScatterNode } from '../entities/dag/ScatterNode.js';
import type { TerminalNode } from '../entities/dag/TerminalNode.js';
import { ConfigurationError } from '../errors/index.js';
import type { NodeStateInterface } from '../NodeStateBase.js';
import { NoopWarningEmitter } from '../runtime/NoopWarningEmitter.js';

import type { Path } from './Path.js';
import { ScatterOptions } from './ScatterOptions.js';

/** Co-located defaults for `terminal()` options. */
const TERMINAL_DEFAULTS = { 'outcome': 'completed' } as const satisfies { readonly outcome: 'completed' | 'failed' };

/** Module-level singleton used as the default warning emitter for `build()`. */
const DEFAULT_WARNING_EMITTER: WarningEmitter = new NoopWarningEmitter();

/** Co-located defaults for `build()` options. */
const BUILD_DEFAULTS = { 'warningEmitter': DEFAULT_WARNING_EMITTER } as const satisfies { readonly warningEmitter: WarningEmitter };

/**
 * Progressive path typing: resolves to `Path<T>` when `T` is a concrete state
 * subtype (the caller passed an explicit state generic), or to `string` when
 * `T = NodeStateInterface` (the default). Authoring an untyped DAG keeps loose
 * `string` paths; passing the state type narrows them to its real dotted paths.
 */
type ParentPath<T extends NodeStateInterface> =
  NodeStateInterface extends T ? string : Path<T>;

/**
 * Configuration for a scatter node added via `DAGBuilder.scatter`.
 *
 * `gather` is required: every scatter must declare how clone state merges
 * back into the parent. Use `{ strategy: 'discard' }` for side-effect-only
 * scatters where no clone state needs to flow back.
 *
 * `TState` narrows `inputs` values and `gather.mapping` values to dotted
 * paths that exist on the state when a concrete subtype is passed.
 */
export interface ScatterOptionsInterface<TState extends NodeStateInterface = NodeStateInterface> {
  /** Metadata key under which each item is written per clone. Defaults to `currentItem`. */
  itemKey?: string;
  /** Maximum number of clones run concurrently. Defaults to item count. */
  concurrency?: number;
  /**
   * Seed each clone before its body runs (becomes `stateMapping.input`); same
   * concept and orientation as `EmbeddedDAGNode` `inputs`: keys are child-state
   * keys, values are parent-state dotted paths (narrowed to `Path<TState>` when
   * `TState` is a concrete subtype).
   */
  inputs?: Partial<Record<string, ParentPath<TState>>>;
  /**
   * Gather config: how produced clone state merges back into the parent.
   * Required — every scatter must declare the merge strategy. Declare
   * `{ strategy: 'discard' }` for side-effect-only fan-outs.
   */
  gather: GatherConfig;
  /** Outcome reducer name. Defaults to `'aggregate'`. */
  reducer?: string;
  /**
   * Logical container role for scatter dag-body execution. The dispatcher
   * binds role names to `DagContainerInterface` instances at construction.
   * Honored only when the body is a `{dag: string}` body. A node body
   * with `container` set is a validation error.
   */
  container?: string;
}

/**
 * Typed embedded-DAG options. Both generics narrow path strings at compile
 * time: `TChildState` narrows the LEFT side of `inputs` and the RIGHT side of
 * `outputs`; `TParentState` narrows the RIGHT side of `inputs` and the LEFT
 * side of `outputs`. Both default to `NodeStateInterface`, which relaxes the
 * narrowed paths back to `string`.
 *
 * @example
 * ```ts
 * builder.embeddedDAG<ChildState, ParentState>('invoke', 'child-dag', routes, {
 *   inputs:  { payload: 'user.name' },   // child key ← parent path
 *   outputs: { 'user.age': 'result' },   // parent path ← child path
 * });
 * ```
 */
export interface TypedEmbeddedDAGOptionsInterface<
  TChildState extends NodeStateInterface = NodeStateInterface,
  TParentState extends NodeStateInterface = NodeStateInterface,
> {
  /** Input mapping: child-state key → parent-state dotted path. Copied into the child before the embedded-DAG runs. A mapping covers only the keys it seeds; omit it entirely when no seeding is needed. */
  inputs?:  Partial<Record<keyof TChildState & string, ParentPath<TParentState>>>;
  /** Output mapping: parent-state dotted path → child-state dotted path. Copied back into the parent after it completes. A mapping covers only the keys it copies back; omit it entirely when none. */
  outputs?: Partial<Record<ParentPath<TParentState>, ParentPath<TChildState>>>;
  /**
   * Logical container role for this embedded DAG execution. The dispatcher
   * binds role names to `DagContainerInterface` instances at construction.
   * When absent, the embedded DAG runs in-process.
   */
  container?: string;
}

/**
 * Chainable authoring API that builds a `DAG` in JSON-LD canonical form.
 *
 * Each node placement is assigned:
 *   - `@id`:   `urn:noocodex:dag:<dagName>/node/<placementName>`
 *   - `@type`: the RDF class name (`'SingleNode'`, `'ScatterNode'`, `'EmbeddedDAGNode'`, etc.)
 *
 * @example
 * ```ts
 * const dag = new DAGBuilder('pipeline', '1.0')
 *   .node('validate', validateNode, { valid: 'process', invalid: 'end-invalid' })
 *   .node('process',  processNode,  { success: 'end', error: 'end-fail' })
 *   .terminal('end')
 *   .terminal('end-invalid')
 *   .terminal('end-fail', { outcome: 'failed' })
 *   .build();
 *
 * dispatcher.registerDAG(dag);
 * ```
 */
export class DAGBuilder {
  readonly #name: string;
  readonly #version: string;
  readonly #nodes: DAGNodeType[] = [];
  // Generic erasure: stores type-erased NodeInterface<NodeStateInterface, string, unknown>; all
  // callers retrieve and use the impl through the type-erased base. The explicit type annotation
  // avoids `as` casts at every assignment site — widening happens once at the declaration.
  readonly #nodeImpls: Map<string, NodeInterface<NodeStateInterface, string, unknown>> = new Map();
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
    routes: Record<TOutput, string>,
  ): this {
    this.#nodes.push({
      '@id':     DAG.placementId(this.#name, name),
      '@type':   'SingleNode',
      name,
      'node':    dagNode.name,
      // Generic erasure: TOutput is narrower than string; the entity schema stores string keys.
      'outputs': routes as Record<string, string>,
    });
    this.#nodeImpls.set(name, dagNode as NodeInterface<NodeStateInterface, string, unknown>);
    if (this.#entrypoint === null) this.#entrypoint = name;
    return this;
  }

  /**
   * Append a scatter node. A scatter isolates a state clone per source item,
   * runs a body (registered node or registered sub-DAG) in each clone, and
   * routes on the aggregate outcome.
   *
   * When `body` is a `NodeInterface` the impl is registered automatically and
   * the placement emits `body: { node: body.name }`. When `body` is
   * `{ dag: string }` no impl is registered and the placement emits
   * `body: { dag }`.
   *
   * Supply `TState` to narrow `options.inputs` values and
   * `options.gather.mapping` values to dotted paths on the state.
   *
   * @example
   * ```ts
   * builder.scatter('generate', 'providers', generateNode,
   *   { 'all-success': 'select', 'partial': 'select', 'all-error': 'end-fail', 'empty': 'end' },
   *   { gather: { strategy: 'map', mapping: { candidate: 'candidates' } } },
   * );
   * ```
   */
  scatter<TState extends NodeStateInterface, TOutput extends string, TServices = undefined>(
    name: string,
    source: string,
    body: NodeInterface<TState, TOutput, TServices> | { readonly dag: string },
    outputs: Record<string, string>,
    options: ScatterOptionsInterface<TState>,
  ): this {
    // Materialise static defaults (itemKey, reducer) at build time so the produced
    // ScatterNode always carries them. Fields whose defaults are data-dependent at
    // runtime (concurrency) or whose absence is semantically meaningful (inputs,
    // container) remain optional and are spread only when the caller provides them.
    const resolved = ScatterOptions.from(options);
    const scatterNode: ScatterNode = {
      '@id':     DAG.placementId(this.#name, name),
      '@type':   'ScatterNode',
      name,
      'source':  source,
      // Generic erasure: the dag-branch is already narrowed by the `'dag' in body` guard;
      // the node-branch cast drops TState/TOutput/TServices which the entity shape doesn't carry.
      'body':    'dag' in body ? { 'dag': body.dag } : { 'node': (body as NodeInterface<TState, TOutput, TServices>).name },
      'gather':  resolved.gather,
      // outputs: Record<string, string> satisfies ScatterNode['outputs'].
      'outputs': outputs as Record<string, string>,
      // itemKey and reducer: always present — materialised from resolved defaults.
      'itemKey': resolved.itemKey,
      'reducer': resolved.reducer,
      // Optional fields spread at construction — no post-construction shape mutation.
      // concurrency: left optional — default is source.length at runtime (data-dependent).
      ...(resolved.concurrency !== undefined ? { 'concurrency': resolved.concurrency } : {}),
      // stateMapping.input: left optional — absence means "no clone seeding" (semantically meaningful).
      // ParentPath<TState> is structurally string; FromSchema index-signature requires Record<string,string>.
      ...(resolved.inputs !== undefined ? { 'stateMapping': { 'input': resolved.inputs as Record<string, string> } } : {}),
      // container: left optional — absence means "run in-process" (semantically meaningful).
      ...(resolved.container !== undefined ? { 'container': resolved.container } : {}),
    };

    if (!('dag' in body)) {
      this.#nodeImpls.set(name, body as NodeInterface<NodeStateInterface, string, unknown>);
    }

    this.#nodes.push(scatterNode);
    if (this.#entrypoint === null) this.#entrypoint = name;
    return this;
  }

  /**
   * Append an embedded-DAG node: invoke a registered sub-DAG once (cardinality
   * 1), routing the parent on the child's terminal outcome (`success` | `error`).
   * `options.inputs` seeds the child from the parent before it runs;
   * `options.outputs` copies child fields back into the parent after it completes.
   *
   * @example
   * ```ts
   * builder.embeddedDAG<ChildState, ParentState>('invoke', 'child-dag',
   *   { success: 'next', error: 'end-fail' },
   *   { inputs: { payload: 'user.name' }, outputs: { 'user.age': 'result' } },
   * );
   * ```
   */
  embeddedDAG<
    TChildState extends NodeStateInterface = NodeStateInterface,
    TParentState extends NodeStateInterface = NodeStateInterface,
  >(
    name: string,
    dagName: string,
    outputs: Record<'success' | 'error', string>,
    options: TypedEmbeddedDAGOptionsInterface<TChildState, TParentState> = {},
  ): this {
    // ParentPath<T> is structurally string; FromSchema index-signature requires Record<string,string>.
    const stateMapping: NonNullable<EmbeddedDAGNode['stateMapping']> | undefined =
      options.inputs !== undefined || options.outputs !== undefined
        ? {
          ...(options.inputs  !== undefined ? { 'input':  options.inputs  as Record<string, string> } : {}),
          ...(options.outputs !== undefined ? { 'output': options.outputs as Record<string, string> } : {}),
        }
        : undefined;
    const embeddedNode: EmbeddedDAGNode = {
      '@id':     DAG.placementId(this.#name, name),
      '@type':   'EmbeddedDAGNode',
      name,
      'dag':     dagName,
      // Record<'success'|'error', string> satisfies EmbeddedDAGNode['outputs']: Record<string, string>.
      'outputs': outputs as Record<string, string>,
      // Optional fields spread at construction — no post-construction shape mutation.
      ...(stateMapping !== undefined ? { 'stateMapping': stateMapping } : {}),
      ...(options.container !== undefined ? { 'container': options.container } : {}),
    };

    this.#nodes.push(embeddedNode);
    if (this.#entrypoint === null) this.#entrypoint = name;
    return this;
  }

  /**
   * Append a terminal node. When reached, the flow ends with the given
   * `outcome`. Defaults to `'completed'`; the flow resolves cleanly.
   * `'failed'` marks the state as failed before resolving.
   *
   * TerminalNodes have no routing (`outputs` map). They are placement-only
   * constructs with no backing `NodeInterface`.
   *
   * @param options.outcome - Terminal outcome. Defaults to `'completed'`.
   */
  terminal(name: string, options: { outcome?: 'completed' | 'failed' } = {}): this {
    const { outcome } = { ...TERMINAL_DEFAULTS, ...options };
    const placement: TerminalNode = {
      '@id':   DAG.placementId(this.#name, name),
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
   * Phase placements are out-of-band; they have no `outputs`, never the
   * main-loop entrypoint, and never route to other placements.
   */
  phase<TState extends NodeStateInterface, TOutput extends string, TServices = undefined>(
    name: string,
    phase: 'pre' | 'post',
    dagNode: NodeInterface<TState, TOutput, TServices>,
  ): this {
    const placement: PhaseNode = {
      '@id':   DAG.placementId(this.#name, name),
      '@type': 'PhaseNode',
      name,
      'node':  dagNode.name,
      phase,
    };
    this.#nodes.push(placement);
    // Generic erasure: impl map stores type-erased base; callers retrieve it untyped.
    this.#nodeImpls.set(name, dagNode as NodeInterface<NodeStateInterface, string, unknown>);
    // Intentionally does NOT set entrypoint; phase placements are
    // out-of-band and never the main-loop entry.
    return this;
  }

  /**
   * Materialize the accumulated nodes into a canonical JSON-LD `DAG` document.
   *
   * When any placement registered via `.node()` or `.scatter()` carries a
   * `contract` on its underlying `NodeInterface`, `build()` runs the same
   * dangling-read / dead-write validation that `DAGDeriver` runs at derive
   * time. Dangling reads throw `DAGError`; dead writes are routed to
   * `options.warningEmitter` (no-op if omitted).
   *
   * @param options - Build options.
   * @param options.warningEmitter - Receives dead-write warnings. Defaults to
   *   a no-op emitter; dead writes are silently discarded. Dangling reads always throw.
   */
  build(options: { warningEmitter?: WarningEmitter } = {}): DAG {
    const { warningEmitter } = { ...BUILD_DEFAULTS, ...options };
    if (this.#entrypoint === null) {
      throw new ConfigurationError(`DAGBuilder('${this.#name}'): cannot build DAG without an entrypoint; call .entrypoint() or add at least one node first`);
    }
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      DAG.id(this.#name),
      '@type':    'DAG',
      'name':       this.#name,
      'version':    this.#version,
      'entrypoint': this.#entrypoint,
      'nodes':      [...this.#nodes] as DAG['nodes'],
    };

    // Run contract validation for the subset of placements registered via
    // .node() / .scatter() whose underlying NodeInterface carries a contract.
    // Placements not tracked in #nodeImpls are
    // intentionally skipped; no false-positive dangling-read errors.
    const contractNodes = [...this.#nodeImpls.values()].filter(
      (impl) => impl.contract !== undefined,
    );
    if (contractNodes.length > 0) {
      const contracts = DAGDeriver.extractContracts(contractNodes);
      ContractRegistryValidator.validate(
        contracts,
        warningEmitter,
        { 'entrypointName': this.#entrypoint },
      );
    }

    return dag;
  }

  /**
   * Construct a DAG directly from a node registry; every node-with-contract
   * participates in derivation; the linear topology follows
   * produces ↔ hardRequired matching. Equivalent to calling
   * `DAGDeriver.derive({ name, version, entrypoint, nodes })` and returning
   * the resulting DAG. Use when your flow is linear and every node carries
   * a contract; drop into the fluent `.node()` API when the shape requires
   * manual placement (scatter, terminals, embedded-DAGs).
   *
   * @param name - DAG name.
   * @param version - DAG version string.
   * @param entrypoint - Name of the entrypoint node.
   * @param nodes - Ordered registry of node implementations.
   * @param options - Optional configuration.
   * @param options.annotations - Optional deriver annotation overrides.
   */
  static fromNodes(
    name: string,
    version: string,
    entrypoint: string,
    nodes: NodeInterface[],
    options: { annotations?: DAGDeriverAnnotations } = {},
  ): DAG {
    const deriveOpts = options.annotations !== undefined
      ? { name, version, entrypoint, nodes, 'annotations': options.annotations }
      : { name, version, entrypoint, nodes };
    return DAGDeriver.derive(deriveOpts);
  }
}
