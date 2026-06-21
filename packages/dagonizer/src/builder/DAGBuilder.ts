/**
 * DAGBuilder: explicit fluent authoring API for `DAG`.
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
import { DAGIdentity, DAG_CONTEXT } from '../entities/dag/DAG.js';
import type { DAGType } from '../entities/dag/DAG.js';
import type { EmbeddedDAGNodeType } from '../entities/dag/EmbeddedDAGNode.js';
import type { GatherConfigType } from '../entities/dag/GatherConfig.js';
import type { PhaseNodeType } from '../entities/dag/PhaseNode.js';
import type { DAGNodeType } from '../entities/dag/Placement.js';
import type { ScatterNodeType } from '../entities/dag/ScatterNode.js';
import type { TerminalNodeType } from '../entities/dag/TerminalNode.js';
import { ConfigurationError } from '../errors/index.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

import type { PathType } from './PathType.js';
import { ScatterOptions } from './ScatterOptions.js';

/** Co-located defaults for `terminal()` options. */
const TERMINAL_DEFAULTS = { 'outcome': 'completed' } as const satisfies { readonly outcome: 'completed' | 'failed' };

/**
 * Progressive path typing: resolves to `PathType<T>` when `T` is a concrete state
 * subtype (the caller passed an explicit state generic), or to `string` when
 * `T = NodeStateInterface` (the default). Authoring an untyped DAG keeps loose
 * `string` paths; passing the state type narrows them to its real dotted paths.
 */
type ParentPath<T extends NodeStateInterface> =
  NodeStateInterface extends T ? string : PathType<T>;

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
export type ScatterOptionsType<TState extends NodeStateInterface = NodeStateInterface> = {
  /** Metadata key under which each item is written per clone. Defaults to `currentItem`. */
  itemKey?: string;
  /** Maximum number of clones run concurrently. Defaults to item count. */
  concurrency?: number;
  /**
   * Seed each clone before its body runs (becomes `stateMapping.input`); same
   * concept and orientation as `EmbeddedDAGNode` `inputs`: keys are child-state
   * keys, values are parent-state dotted paths (narrowed to `PathType<TState>` when
   * `TState` is a concrete subtype).
   */
  inputs?: Partial<Record<string, ParentPath<TState>>>;
  /**
   * Gather config: how produced clone state merges back into the parent.
   * Required — every scatter must declare the merge strategy. Declare
   * `{ strategy: 'discard' }` for side-effect-only fan-outs.
   */
  gather: GatherConfigType;
  /** Outcome reducer name. Defaults to `'aggregate'`. */
  reducer?: string;
  /**
   * Logical container role for scatter dag-body execution. The dispatcher
   * binds role names to `DagContainerInterface` instances at construction.
   * Honored only when the body is a `{dag: string}` body. A node body
   * with `container` set is a validation error.
   */
  container?: string;
  /**
   * Input-batching policy. When present, the scatter buffers items by
   * `keyField` (an accessor path on each item) and releases a batch per key
   * when `capacity` items accumulate or `idleMs` milliseconds of idle elapses.
   * Absent means batch-size-1 (today's behavior; no runtime effect yet).
   */
  reservoir?: {
    /** Accessor path on each item whose resolved value is the partition key. */
    readonly keyField: string;
    /** Release a key's batch when it reaches this many items. Must be >= 1. */
    readonly capacity: number;
    /** Release a key's partial batch after this many idle milliseconds. Must be > 0 when present. */
    readonly idleMs?: number;
  };
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
export type TypedEmbeddedDAGOptionsType<
  TChildState extends NodeStateInterface = NodeStateInterface,
  TParentState extends NodeStateInterface = NodeStateInterface,
> = {
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
 * Explicit fluent API that builds a `DAG` in JSON-LD canonical form.
 *
 * Each node placement is assigned:
 *   - `@id`:   `urn:noocodex:dag:<dagName>/node/<placementName>`
 *   - `@type`: the RDF class name (`'SingleNode'`, `'ScatterNode'`, `'EmbeddedDAGNode'`, etc.)
 *
 * `DAGBuilder` is the single, compile-checked way to construct a DAG.
 * Topology is declared explicitly via `.node()`, `.scatter()`, `.embeddedDAG()`,
 * `.terminal()`, and `.phase()`. If the wiring does not type-check, it does not build.
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
      '@id':     DAGIdentity.placementId(this.#name, name),
      '@type':   'SingleNode',
      name,
      'node':    dagNode.name,
      'outputs': routes,
    });
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
    body: NodeInterface<TState, TOutput, TServices> | { readonly dag: string } | { readonly dagFrom: string },
    outputs: Record<string, string>,
    options: ScatterOptionsType<TState>,
  ): this {
    // Materialise static defaults (itemKey, reducer) at build time so the produced
    // ScatterNode always carries them. Fields whose defaults are data-dependent at
    // runtime (concurrency) or whose absence is semantically meaningful (inputs,
    // container) remain optional and are spread only when the caller provides them.
    const resolved = ScatterOptions.resolve(options);

    // Resolve body to the wire shape: node, dag, or dagFrom.
    let wireBody: ScatterNodeType['body'];
    if ('dag' in body) {
      wireBody = { 'dag': body.dag };
    } else if ('dagFrom' in body) {
      wireBody = { 'dagFrom': body.dagFrom };
    } else {
      wireBody = { 'node': body.name };
    }

    const scatterNode: ScatterNodeType = {
      '@id':     DAGIdentity.placementId(this.#name, name),
      '@type':   'ScatterNode',
      name,
      'source':  source,
      'body':    wireBody,
      'gather':  resolved.gather,
      'outputs': outputs,
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
      // reservoir: left optional — absence means batch-size-1 (today's behavior unchanged).
      ...(resolved.reservoir !== undefined ? { 'reservoir': resolved.reservoir } : {}),
    };

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
   * `dag` is either:
   * - a `string` (build-time literal dag name, validated at `registerDAG` time), or
   * - `{ from: string }` (a dotted state path read at runtime; an unregistered
   *   resolved name routes the placement to `error` without throwing).
   *
   * @example
   * ```ts
   * // Build-time literal:
   * builder.embeddedDAG<ChildState, ParentState>('invoke', 'child-dag',
   *   { success: 'next', error: 'end-fail' },
   *   { inputs: { payload: 'user.name' }, outputs: { 'user.age': 'result' } },
   * );
   * // Runtime state path:
   * builder.embeddedDAG('invoke', { from: 'selectedDag' },
   *   { success: 'next', error: 'end-fail' },
   * );
   * ```
   */
  embeddedDAG<
    TChildState extends NodeStateInterface = NodeStateInterface,
    TParentState extends NodeStateInterface = NodeStateInterface,
  >(
    name: string,
    dag: string | { readonly from: string },
    outputs: Record<'success' | 'error', string>,
    options: TypedEmbeddedDAGOptionsType<TChildState, TParentState> = {},
  ): this {
    // ParentPath<T> is structurally string; FromSchema index-signature requires Record<string,string>.
    const stateMapping: NonNullable<EmbeddedDAGNodeType['stateMapping']> | undefined =
      options.inputs !== undefined || options.outputs !== undefined
        ? {
          ...(options.inputs  !== undefined ? { 'input':  options.inputs  as Record<string, string> } : {}),
          ...(options.outputs !== undefined ? { 'output': options.outputs as Record<string, string> } : {}),
        }
        : undefined;

    // Resolve dag vs dagFrom: exactly one is set on the wire node.
    const dagField: { dag: string } | { dagFrom: string } =
      typeof dag === 'string' ? { 'dag': dag } : { 'dagFrom': dag.from };

    const embeddedNode: EmbeddedDAGNodeType = {
      '@id':     DAGIdentity.placementId(this.#name, name),
      '@type':   'EmbeddedDAGNode',
      name,
      'outputs': outputs,
      // Exactly one of dag | dagFrom, spread at construction — no post-construction shape mutation.
      ...dagField,
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
    const placement: TerminalNodeType = {
      '@id':   DAGIdentity.placementId(this.#name, name),
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
    const placement: PhaseNodeType = {
      '@id':   DAGIdentity.placementId(this.#name, name),
      '@type': 'PhaseNode',
      name,
      'node':  dagNode.name,
      phase,
    };
    this.#nodes.push(placement);
    // Intentionally does NOT set entrypoint; phase placements are
    // out-of-band and never the main-loop entry.
    return this;
  }

  /**
   * Materialize the accumulated nodes into a canonical JSON-LD `DAG` document.
   *
   * Validates that an entrypoint has been set, then assembles the `DAGType`
   * from all registered placements and returns it. Both dangling-read and
   * dead-write checks require explicit wiring — the fluent API is the
   * compile-checked contract: if the routing does not type-check, the DAG
   * does not build.
   */
  build(): DAGType {
    if (this.#entrypoint === null) {
      throw new ConfigurationError(`DAGBuilder('${this.#name}'): cannot build DAG without an entrypoint; call .entrypoint() or add at least one node first`);
    }
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      DAGIdentity.id(this.#name),
      '@type':    'DAG',
      'name':       this.#name,
      'version':    this.#version,
      'entrypoint': this.#entrypoint,
      'nodes':      [...this.#nodes],
    };

    return dag;
  }
}
