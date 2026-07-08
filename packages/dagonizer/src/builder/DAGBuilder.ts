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
import type { RetryPolicyOptionsType } from '../contracts/RetryPolicyOptionsType.js';
import { PlaceholderNode } from '../core/PlaceholderNode.js';
import { DAGIdentity, DAG_CONTEXT } from '../entities/dag/DAG.js';
import type { DAGType } from '../entities/dag/DAG.js';
import type { DagReferenceType } from '../entities/dag/DagReference.js';
import type { EmbeddedDAGNodeType } from '../entities/dag/EmbeddedDAGNode.js';
import type { GatherConfigType } from '../entities/dag/GatherConfig.js';
import type { GatherNodeType, GatherPolicyType } from '../entities/dag/GatherNode.js';
import type { PhaseNodeType } from '../entities/dag/PhaseNode.js';
import type { DAGNodeType } from '../entities/dag/Placement.js';
import type { ScatterExecutionOptionsType, ScatterNodeType } from '../entities/dag/ScatterNode.js';
import type { TerminalNodeType } from '../entities/dag/TerminalNode.js';
import { DAGError } from '../errors/index.js';
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
 * `gather` declares how clone state merges back into the parent; omitting
 * it defaults to `{ strategy: 'discard' }` (side-effect-only fan-out).
 * Declare it explicitly to merge clone state back into the parent.
 *
 * `TState` narrows `inputs` values and `gather.mapping` values to dotted
 * paths that exist on the state when a concrete subtype is passed.
 */
export type ScatterOptionsType<TState extends NodeStateInterface = NodeStateInterface> = {
  /** Metadata key under which each item is written per clone. Defaults to `currentItem`. */
  itemKey?: string;
  /**
   * Seed each clone before its body runs (becomes `stateMapping.input`); same
   * concept and orientation as `EmbeddedDAGNode` `inputs`: keys are child-state
   * keys, values are parent-state dotted paths (narrowed to `PathType<TState>` when
   * `TState` is a concrete subtype).
   */
  inputs?: Record<string, ParentPath<TState>>;
  /**
   * Gather config: how produced clone state merges back into the parent.
   * Defaults to `{ strategy: 'discard' }` (side-effect-only fan-out, no
   * clone state flows back) when omitted — see `SCATTER_GATHER_DEFAULT`
   * in `ScatterOptions.ts`. Declare explicitly to merge clone state back
   * into the parent.
   */
  gather?: GatherConfigType;
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
   * Concurrency-limiting policy: ONE discriminated `mode` structure instead of
   * separate `concurrency`/`throttle`/`reservoir` knobs — the exact wire shape
   * `ScatterNode.execution` accepts (see `ScatterNode.ts` for full semantics).
   * Defaults to `{ mode: 'item', concurrency: 1 }` when omitted.
   */
  execution?: ScatterExecutionOptionsType;
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
  inputs?:  Record<string, ParentPath<TParentState>>;
  /** Output mapping: parent-state dotted path → child-state dotted path. Copied back into the parent after it completes. A mapping covers only the keys it copies back; omit it entirely when none. */
  outputs?: Record<string, ParentPath<TChildState>>;
  /**
   * Project one child-state field as the scalar value emitted to a downstream
   * first-class gather. This does not copy state back by itself; use `outputs`
   * for direct parent mutation.
   */
  gatherResult?: { readonly resultField: ParentPath<TChildState> };
  /**
   * Logical container role for this embedded DAG execution. The dispatcher
   * binds role names to `DagContainerInterface` instances at construction.
   * When absent, the embedded DAG runs in-process.
   */
  container?: string;
}

/** Dynamic DAG reference accepted by the unified builder entrypoints. */
export type DynamicDAGReferenceInputType<TFrom extends 'state' | 'item' = 'state' | 'item'> = {
  readonly from: TFrom;
  readonly path: string;
  readonly candidates: readonly [string, ...string[]];
};

export type StateDAGReferenceInputType = DynamicDAGReferenceInputType<'state'>;
export type ItemDAGReferenceInputType = DynamicDAGReferenceInputType<'item'>;

/** A DAG reference accepted by the unified `embed()` builder entrypoint. */
export type EmbeddableDAGType = string | DAGType | StateDAGReferenceInputType;

/** A DAG body reference accepted by `scatter()`. */
export type ScatterDAGBodyType = { readonly dag: string | ItemDAGReferenceInputType };

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
  readonly #entrypoints = new Map<string, string>();

  constructor(name: string, version: string) {
    this.#name = name;
    this.#version = version;
  }

  /** Normalize any embeddable DAG reference into the wire shape. */
  private static embeddedDagField(
    dag: EmbeddableDAGType,
  ): { dag: DagReferenceType } {
    if (typeof dag === 'string') {
      return { 'dag': dag };
    }
    if ('candidates' in dag) {
      if (dag.from !== 'state') {
        throw new DAGError(`DAGBuilder.embed(): dynamic DAG reference must use from='state'`);
      }
      return {
        'dag': {
          '@type': 'DagReference',
          'from': dag.from,
          'path': dag.path,
          'candidates': [...dag.candidates],
        },
      };
    }
    return { 'dag': dag.name };
  }

  private static scatterDagField(body: ScatterDAGBodyType): { dag: DagReferenceType } {
    if (typeof body.dag === 'string') {
      return { 'dag': body.dag };
    }
    if (body.dag.from !== 'item') {
      throw new DAGError(`DAGBuilder.scatter(): dynamic DAG reference must use from='item'`);
    }
    return {
      'dag': {
        '@type': 'DagReference',
        'from': body.dag.from,
        'path': body.dag.path,
        'candidates': [...body.dag.candidates],
      },
    };
  }

  #defaultEntrypoint(name: string): void {
    if (this.#entrypoints.size === 0) {
      this.#entrypoints.set('main', name);
    }
  }

  /** Set (or override) the entrypoint node name. */
  entrypoint(nodeName: string): this {
    if (nodeName.length === 0) {
      throw new DAGError(
        `DAGBuilder('${this.#name}'): entrypoint node name must be non-empty`,
        { 'code': 'CONFIGURATION_ERROR' },
      );
    }
    this.#entrypoints.clear();
    this.#entrypoints.set('main', nodeName);
    return this;
  }

  /** Set labeled DAG entrypoints. */
  entrypoints(entries: Readonly<Record<string, string>>): this {
    this.#entrypoints.clear();
    for (const [label, nodeName] of Object.entries(entries)) {
      if (label.length === 0) {
        throw new DAGError(
          `DAGBuilder('${this.#name}'): entrypoint label must be non-empty`,
          { 'code': 'CONFIGURATION_ERROR' },
        );
      }
      if (nodeName.length === 0) {
        throw new DAGError(
          `DAGBuilder('${this.#name}'): entrypoint '${label}' node name must be non-empty`,
          { 'code': 'CONFIGURATION_ERROR' },
        );
      }
      this.#entrypoints.set(label, nodeName);
    }
    return this;
  }

  /**
   * Append a single node. The node's `TOutput` parameter
   * narrows `routes`, forcing exhaustive routing at compile time.
   *
   * @param options.retry - Optional retry policy. When set, each `node.execute()`
   *   call is wrapped in `RetryPolicy.from(retry).run(...)` with the node abort
   *   signal threaded through. When absent, defaults to `NO_RETRY` (one attempt).
   */
  node<TState extends NodeStateInterface, TOutput extends string>(
    name: string,
    dagNode: NodeInterface<TState, TOutput>,
    routes: Record<TOutput, string>,
    options: { readonly retry?: RetryPolicyOptionsType } = {},
  ): this {
    const base = {
      '@id':     DAGIdentity.placementId(this.#name, name),
      '@type':   'SingleNode' as const,
      name,
      'node':    dagNode.name,
      'outputs': routes,
    };
    const placement = options.retry !== undefined
      ? { ...base, 'retry': options.retry }
      : base;
    this.#nodes.push(placement);
    this.#defaultEntrypoint(name);
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
  scatter<TState extends NodeStateInterface, TOutput extends string>(
    name: string,
    source: string,
    body: NodeInterface<TState, TOutput> | ScatterDAGBodyType,
    outputs: Record<string, string>,
    options: ScatterOptionsType<TState>,
  ): this {
    // Materialise static defaults (itemKey, reducer, gather) at build time so the
    // produced ScatterNode always carries them. Fields whose defaults are data-dependent
    // at runtime (execution) or whose absence is semantically meaningful (inputs,
    // container) remain optional and are spread only when the caller provides them.
    const resolved = ScatterOptions.resolve(options);

    // Resolve body to the wire shape: node or graph-addressable dag reference.
    let wireBody: ScatterNodeType['body'];
    if ('dag' in body) {
      wireBody = DAGBuilder.scatterDagField(body);
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
      // stateMapping.input: left optional — absence means "no clone seeding" (semantically meaningful).
      ...(resolved.inputs !== undefined ? { 'stateMapping': { 'input': resolved.inputs } } : {}),
      // container: left optional — absence means "run in-process" (semantically meaningful).
      ...(resolved.container !== undefined ? { 'container': resolved.container } : {}),
      // execution: left optional — default is `{ mode: 'item', concurrency: 1 }` at runtime (data-dependent).
      ...(resolved.execution !== undefined ? { 'execution': resolved.execution } : {}),
    };

    this.#nodes.push(scatterNode);
    this.#defaultEntrypoint(name);
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
   * - `{ from: 'state', path, candidates }` (a dotted parent-state path read at
   *   runtime and constrained to the declared candidate DAG set).
   *
   * @example
   * ```ts
   * // Build-time literal:
   * builder.embeddedDAG<ChildState, ParentState>('invoke', 'child-dag',
   *   { success: 'next', error: 'end-fail' },
   *   { inputs: { payload: 'user.name' }, outputs: { 'user.age': 'result' } },
   * );
   * // Runtime state path constrained by declared candidates:
   * builder.embeddedDAG('invoke', { from: 'state', path: 'selectedDag', candidates: ['child'] },
   *   { success: 'next', error: 'end-fail' },
   * );
   * ```
   */
  embed<
    TChildState extends NodeStateInterface = NodeStateInterface,
    TParentState extends NodeStateInterface = NodeStateInterface,
  >(
    name: string,
    dag: EmbeddableDAGType,
    outputs: Record<'success' | 'error', string>,
    options: TypedEmbeddedDAGOptionsType<TChildState, TParentState> = {},
  ): this {
    // ParentPath<T> is structurally string; FromSchema index-signature requires Record<string,string>.
    const stateMapping: NonNullable<EmbeddedDAGNodeType['stateMapping']> | undefined =
      options.inputs !== undefined || options.outputs !== undefined
        ? {
          ...(options.inputs  !== undefined ? { 'input':  options.inputs  } : {}),
          ...(options.outputs !== undefined ? { 'output': options.outputs } : {}),
        }
        : undefined;

    const embeddedNode: EmbeddedDAGNodeType = {
      '@id':     DAGIdentity.placementId(this.#name, name),
      '@type':   'EmbeddedDAGNode',
      name,
      'outputs': outputs,
      // Literal names and dynamic DagReference values share the canonical `dag` field.
      ...DAGBuilder.embeddedDagField(dag),
      // Optional fields spread at construction — no post-construction shape mutation.
      ...(stateMapping !== undefined ? { 'stateMapping': stateMapping } : {}),
      ...(options.gatherResult !== undefined ? { 'gatherResult': options.gatherResult } : {}),
      ...(options.container !== undefined ? { 'container': options.container } : {}),
    };

    this.#nodes.push(embeddedNode);
    this.#defaultEntrypoint(name);
    return this;
  }

  /**
   * Append an embedded-DAG node with the legacy method name.
   *
   * `embed()` is the canonical entrypoint; this method remains as the existing
   * API and delegates to the same normalization path.
   */
  embeddedDAG<
    TChildState extends NodeStateInterface = NodeStateInterface,
    TParentState extends NodeStateInterface = NodeStateInterface,
  >(
    name: string,
    dag: EmbeddableDAGType,
    outputs: Record<'success' | 'error', string>,
    options: TypedEmbeddedDAGOptionsType<TChildState, TParentState> = {},
  ): this {
    return this.embed(name, dag, outputs, options);
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
    this.#defaultEntrypoint(name);
    return this;
  }

  /**
   * Register and wire a PlaceholderNode in one call.
   *
   * The node routes every execution to the first declared output. Use during
   * development to stub unimplemented placements; replace with a concrete node
   * subclass when ready. The registered node can be retrieved from the dispatcher
   * by name to swap it out later.
   *
   * @param name    - The node name (also the placement name).
   * @param outputs - Ordered output names; the first is the unconditional route.
   * @param routes  - Route map (same shape as .node() routes).
   */
  placeholder<TOutput extends string>(
    name: string,
    outputs: readonly [TOutput, ...TOutput[]],
    routes: Record<TOutput, string>,
  ): this {
    const node = new PlaceholderNode<NodeStateInterface, TOutput>(name, outputs);
    return this.node(name, node, routes);
  }

  /** Append a first-class gather barrier placement. */
  gather(
    name: string,
    sources: readonly [string, ...string[]],
    gather: GatherConfigType,
    outputs: Record<string, string>,
    options: { readonly policy?: GatherPolicyType } = {},
  ): this {
    const placement: GatherNodeType = {
      '@id': DAGIdentity.placementId(this.#name, name),
      '@type': 'GatherNode',
      name,
      'sources': [...sources],
      gather,
      outputs,
      ...(options.policy !== undefined ? { 'policy': options.policy } : {}),
    };
    this.#nodes.push(placement);
    this.#defaultEntrypoint(name);
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
  phase<TState extends NodeStateInterface, TOutput extends string>(
    name: string,
    phase: 'pre' | 'post',
    dagNode: NodeInterface<TState, TOutput>,
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
    if (this.#entrypoints.size === 0) {
      throw new DAGError(`DAGBuilder('${this.#name}'): cannot build DAG without entrypoints; call .entrypoint(), .entrypoints(), or add at least one placement first`, { 'code': 'CONFIGURATION_ERROR' });
    }
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      DAGIdentity.id(this.#name),
      '@type':    'DAG',
      'name':       this.#name,
      'version':    this.#version,
      'entrypoints': Object.fromEntries(this.#entrypoints),
      'nodes':      [...this.#nodes],
    };

    return dag;
  }
}
