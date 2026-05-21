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
 *               per-item kind (node or sub-DAG), the fan-in strategy
 *               with its strategy-specific fields, and the fan-out
 *               outcome names.
 *   subDAGs   — operations that delegate execution to a nested
 *               registered DAG. Renders as a `DeepDAGNode` placement
 *               with the supplied `dag` name and optional state
 *               mapping. Every port in `outputs` auto-wires to the
 *               next derived stage; `terminals` overrides per-port.
 *   parallels — explicit `ParallelNode` groupings with a chosen
 *               combine strategy. Without it, same-topological-depth
 *               operations auto-group with `combine: 'collect'`.
 */

/** Per-operation alternate exit. `target: null` ends the flow. */
export interface DAGDeriverTerminal {
  readonly outcome: string;
  readonly target:  string | null;
}

/**
 * Common fields every fan-out annotation carries regardless of
 * strategy. The per-item kind is a registered node — fan-out over
 * a registered sub-DAG would require an engine FanOutNode schema
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
 * Per-operation sub-DAG composition. The operation's contract still
 * declares `produces ↔ hardRequired` for topology derivation; the
 * annotation only swaps the rendered placement from `SingleNode` to
 * `DeepDAGNode`.
 */
export interface DAGDeriverSubDAG {
  /** Registered DAG name to invoke as the deep-DAG. */
  readonly dag: string;
  /**
   * Optional state mapping copied into / out of the child execution.
   * Mirrors `DeepDAGNode.stateMapping` in the engine.
   */
  readonly stateMapping?: {
    readonly input?:  Readonly<Record<string, string>>;
    readonly output?: Readonly<Record<string, string>>;
  };
  /**
   * Output ports the deep-DAG can route on. Each port auto-wires to
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
  readonly subDAGs?:   Readonly<Record<string, DAGDeriverSubDAG>>;
  readonly parallels?: Readonly<Record<string, DAGDeriverParallel>>;
}
