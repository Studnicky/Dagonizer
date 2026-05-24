import type { NodeStateInterface } from '../NodeStateBase.js';

/**
 * DAGDeriverAnnotations — declarative hooks for routing the contract-derived
 * flow cannot express by data-graph alone.
 *
 *   terminals — alternate exit outputs that terminate the flow rather
 *               than continuing into the next derived stage. Useful for
 *               operations whose non-success outcomes route to `null`.
 *   fanouts   — operations whose data-graph successor is reached by
 *               fan-out over a state-array source. Specifies the source
 *               path, the per-item key, the concurrency cap, the
 *               per-item kind (node or embedded-DAG), the fan-in strategy
 *               with its strategy-specific fields, and the fan-out
 *               outcome names.
 *   embeddedDAGs   — operations that delegate execution to a nested
 *               registered DAG. Renders as a `EmbeddedDAGNode` placement
 *               with the supplied `dag` name and optional state
 *               mapping. Every port in `outputs` auto-wires to the
 *               next derived stage; `terminals` overrides per-port.
 *   parallels — explicit `ParallelNode` groupings with a chosen
 *               combine strategy. Without it, same-topological-depth
 *               operations auto-group with `combine: 'collect'`.
 */

/**
 * Inline TerminalNode placement the deriver synthesizes when the consuming
 * operation hits the named outcome. The deriver materialises a `TerminalNode`
 * entry in the DAG's `nodes` array and routes the operation's matching output
 * port to it.
 */
export interface DAGDeriverEmitTerminal {
  /** Placement name for the synthesized TerminalNode. */
  readonly name: string;
  /** Lifecycle outcome the terminal triggers on the parent run. */
  readonly outcome: 'completed' | 'failed';
}

/**
 * Per-operation alternate exit. Two variants:
 *
 *   - **target variant** (legacy form): `target: null` ends the flow with an
 *     implicit `completed` outcome; `target: string` routes the output port to
 *     the named existing placement.
 *   - **emit variant**: declares an inline `TerminalNode` that the deriver
 *     synthesizes and adds to the DAG. The operation's output port routes to
 *     `emit.name`; the `TerminalNode` carries `emit.outcome` so the engine
 *     marks the run `completed` or `failed` when it is reached. Useful for
 *     marking the parent flow `failed` explicitly on a particular operation
 *     outcome (e.g. `fail` → `TerminalNode{outcome:'failed'}`).
 *
 * Multiple operations may declare `emit` annotations with the same `name` —
 * the deriver deduplicates by name. If two `emit` entries share a name but
 * disagree on `outcome`, `DAGDeriver.derive` throws `DAGError`.
 */
export type DAGDeriverTerminal =
  | { readonly outcome: string; readonly target: string | null }
  | { readonly outcome: string; readonly emit: DAGDeriverEmitTerminal };

/**
 * Common fields every fan-out annotation carries regardless of
 * strategy. The per-item kind is a registered node — fan-out over
 * a registered embedded-DAG would require an engine FanOutNode schema
 * extension and isn't supported in this release.
 */
interface DAGDeriverFanOutBase {
  /** Dotted path on state to the source array. */
  readonly source:       string;
  /** Metadata key the per-item executions read for the current item. */
  readonly itemKey:      string;
  /** Registered node name invoked once per item in the source array. */
  readonly node:         string;
  /** Concurrency cap; defaults to source array length when omitted. */
  readonly concurrency?: number;
  /** Fan-out outcome names the dispatcher routes on. */
  readonly outcomes:     readonly string[];
}

/**
 * Per-operation fan-out wrapping. The fan-in strategy is a
 * discriminated union — each variant carries the
 * strategy-specific fields the engine's `FanInConfig` requires:
 *
 *   ⦿ `'custom'`   — `fanInOperation`: registered node that runs as
 *                    the merge step. The dispatcher passes the
 *                    `Record<outcome, item[]>` map to the node via
 *                    `state.metadata.fanInResults`.
 *   ⦿ `'partition'` — `partitions`: `Record<outcome, statePath>` map
 *                     declaring where each per-outcome item array
 *                     gets written on parent state.
 *   ⦿ `'append'`   — `target`: single dotted state path. Every item
 *                    result (regardless of outcome) is flattened
 *                    into the array at that path.
 *
 * Compile-time discriminator types enforce mutual exclusion;
 * `DAGDeriver.derive` re-validates at runtime as a defensive
 * backstop.
 */
export type DAGDeriverFanOut = DAGDeriverFanOutBase & (
  | { readonly strategy: 'custom';    readonly fanInOperation: string;
      readonly partitions?: never;     readonly target?: never }
  | { readonly strategy: 'partition'; readonly partitions:    Readonly<Record<string, string>>;
      readonly fanInOperation?: never; readonly target?: never }
  | { readonly strategy: 'append';    readonly target:        string;
      readonly fanInOperation?: never; readonly partitions?: never }
);

/**
 * Resolves to `keyof T & string` when `T` is a concrete subtype of
 * `NodeStateInterface` (i.e. the caller passed an explicit `TChildState`);
 * resolves to `string` when `T = NodeStateInterface` (the default). This
 * keeps existing call sites backward-compatible — the child key stays `string`
 * so arbitrary strings continue to typecheck — while enabling narrow checking
 * when a concrete state type is supplied.
 *
 * The check `NodeStateInterface extends T` is true only when `T` is
 * `NodeStateInterface` itself (or a supertype), not when `T` is a concrete
 * subclass that declares extra properties.
 */
type ChildKey<T extends NodeStateInterface> =
  NodeStateInterface extends T ? string : keyof T & string;

/**
 * Per-operation embedded-DAG composition. The operation's contract still
 * declares `produces ↔ hardRequired` for topology derivation; the
 * annotation only swaps the rendered placement from `SingleNode` to
 * `EmbeddedDAGNode`.
 *
 * Supply `TChildState` to narrow `stateMapping.input` keys and
 * `stateMapping.output` values to names that actually exist on the child
 * state at compile time. Omitting `TChildState` (or passing the default
 * `NodeStateInterface`) preserves backward compatibility — any string is
 * accepted on both sides.
 *
 * @example
 * ```ts
 * class ChildState extends NodeStateBase {
 *   payload = '';
 *   result  = 0;
 * }
 *
 * annotations: {
 *   embeddedDAGs: {
 *     invoke: {
 *       dag:     'child-dag',
 *       outputs: ['success', 'error'],
 *       stateMapping: {
 *         input:  { payload: 'parent.seed' },   // 'payload' must be a key of ChildState
 *         output: { 'parent.result': 'result' },
 *       },
 *     } satisfies DAGDeriverEmbeddedDAG<ChildState>,
 *   },
 * }
 * ```
 */
export interface DAGDeriverEmbeddedDAG<TChildState extends NodeStateInterface = NodeStateInterface> {
  /** Registered DAG name to invoke as the embedded-DAG. */
  readonly dag: string;
  /**
   * Optional state mapping copied into / out of the child execution.
   * Mirrors `EmbeddedDAGNode.stateMapping` in the engine.
   *
   * When `TChildState` is a concrete subtype:
   *   - `input` keys are narrowed to `keyof TChildState & string` — a
   *     compile-time error is raised for unknown child-state keys.
   *   - `output` values are narrowed to `keyof TChildState & string`.
   *
   * When `TChildState` is the default `NodeStateInterface`, both sides
   * accept any `string` — preserving backward compatibility.
   *
   * The wire shape written to the rendered `EmbeddedDAGNode` is always
   * `Record<string, string>` — the generic is for authoring ergonomics only.
   */
  readonly stateMapping?: {
    /** Child-state key → parent dotted path. */
    readonly input?:  Readonly<Partial<Record<ChildKey<TChildState>, string>>>;
    /** Parent dotted path → child-state key. */
    readonly output?: Readonly<Partial<Record<string, ChildKey<TChildState>>>>;
  };
  /**
   * Output ports the embedded-DAG can route on. Each port auto-wires to
   * the next derived stage; `DAGDeriverAnnotations.terminals` overrides
   * individual ports.
   */
  readonly outputs: readonly string[];
}

/**
 * Per-grouping explicit parallel placement. Operations listed in
 * `members` execute concurrently under a `ParallelNode` with the
 * specified `combine` strategy, regardless of their data-graph depth.
 *
 * Without this annotation, DAGDeriver auto-groups operations sharing
 * a topological depth with `combine: 'collect'`. Use `parallels`
 * when:
 *   ⦿ Same-depth operations should run sequentially instead
 *     (omit them from any parallels entry — but auto-grouping
 *     activates whenever ≥2 operations share a depth, so the
 *     opt-out path is to flatten the data graph)
 *   ⦿ A combine strategy other than `'collect'` is required
 *   ⦿ Cross-depth operations should be grouped explicitly
 */
export interface DAGDeriverParallel {
  /** Operation names to group into one ParallelNode. */
  readonly members:  readonly string[];
  /** Combine strategy reducing per-member outputs to one routing output. */
  readonly combine:  'all-success' | 'any-success' | 'collect';
}

/**
 * Annotations consumed by `DAGDeriver.derive`. All fields are
 * optional; when all are absent every operation renders as a
 * `SingleNode` with `success` routing to the next derived operation.
 */
export interface DAGDeriverAnnotations {
  readonly terminals?: Readonly<Record<string, readonly DAGDeriverTerminal[]>>;
  readonly fanouts?:   Readonly<Record<string, DAGDeriverFanOut>>;
  readonly embeddedDAGs?:   Readonly<Record<string, DAGDeriverEmbeddedDAG>>;
  readonly parallels?: Readonly<Record<string, DAGDeriverParallel>>;
}
