import type { NodeStateInterface } from '../NodeStateBase.js';

/**
 * DAGDeriverAnnotationsType: declarative hooks for routing the contract-derived
 * flow cannot express by data-graph alone.
 *
 *   terminals: alternate exit outputs that terminate the flow rather
 *              than continuing into the next derived stage. Useful for
 *              operations whose non-success outcomes route to `null`.
 *   scatters: operations whose data-graph successor is reached by
 *             scatter over a state-array source. Specifies the source
 *             path, the per-item key, the concurrency cap, the
 *             per-item variant (node), the gather strategy with its
 *             strategy-specific fields, and the scatter outcome names.
 *   embeddedDAGs: operations that delegate execution to a nested
 *                 registered DAG. Renders as an `EmbeddedDAGNode` placement
 *                 with the supplied `dag` name and optional state mapping.
 *                 Every port in `outputs` auto-wires to the next derived
 *                 stage; `terminals` overrides per-port.
 */

/**
 * Inline TerminalNode placement the deriver synthesizes when the consuming
 * operation hits the named outcome. The deriver materialises a `TerminalNode`
 * entry in the DAG's `nodes` array and routes the operation's matching output
 * port to it.
 */
export type DAGDeriverEmitTerminalType = {
  /** Placement name for the synthesized TerminalNode. */
  name: string;
  /** Lifecycle outcome the terminal triggers on the parent run. */
  outcome: 'completed' | 'failed';
}

/**
 * Per-operation alternate exit. Two distinct concepts, one way each:
 *
 *   - **target variant**: `target: string` routes the output port to a named
 *     existing placement. (Routing only. To END the flow at an outcome, use
 *     the emit variant; there is no implicit null end.)
 *   - **emit variant**: declares an inline `TerminalNode` that the deriver
 *     synthesizes and adds to the DAG. The operation's output port routes to
 *     `emit.name`; the `TerminalNode` carries `emit.outcome` so the engine
 *     marks the run `completed` or `failed` when it is reached. Useful for
 *     marking the parent flow `failed` explicitly on a particular operation
 *     outcome (e.g. `fail` → `TerminalNode{outcome:'failed'}`).
 *
 * Multiple operations may declare `emit` annotations with the same `name`;
 * the deriver deduplicates by name. If two `emit` entries share a name but
 * disagree on `outcome`, `DAGDeriver.derive` throws `DAGError`.
 */
export type DAGDeriverTerminalType =
  | { outcome: string; target: string }
  | { outcome: string; emit: DAGDeriverEmitTerminalType };

/**
 * Sentinel value for `DAGDeriverScatterBase.concurrency` meaning "unbounded —
 * let the engine default resolve concurrency at execution time". The deriver
 * omits `concurrency` from the rendered `ScatterNode` when this value is set,
 * deferring to the dispatcher's `DEFAULT_SCATTER_CONCURRENCY`.
 */
export const DEFAULT_SCATTER_CONCURRENCY = 0;

/**
 * Common fields every scatter annotation carries regardless of strategy.
 * The per-item variant is a registered node.
 */
type DAGDeriverScatterBase = {
  /** Dotted path on state to the source array. */
  source:      string;
  /** Metadata key the per-item executions read for the current item. */
  itemKey:     string;
  /** Registered node name invoked once per item in the source array. */
  node:        string;
  /**
   * Concurrency cap for the scatter. `DEFAULT_SCATTER_CONCURRENCY` (0) means
   * unbounded — the deriver omits `concurrency` from the rendered `ScatterNode`
   * and the engine uses its own runtime default. Set to a positive integer to
   * pin a fixed cap.
   */
  concurrency: number;
  /** Scatter outcome names the dispatcher routes on. */
  outcomes:    string[];
}

/**
 * Per-operation scatter wrapping. The gather strategy is a discriminated
 * union; each variant carries the strategy-specific fields the engine's
 * `GatherConfig` requires:
 *
 *   ⦿ `'custom'`    (customNode): registered node that runs as the merge
 *                     step. The dispatcher passes the `Record<outcome, item[]>`
 *                     map to the node via `state.metadata.gatherResults`.
 *   ⦿ `'partition'` (partitions): `Record<outcome, statePath>` map declaring
 *                     where each per-outcome item array gets written on parent
 *                     state.
 *   ⦿ `'append'`    (target): single dotted state path. Every item result
 *                     (regardless of outcome) is flattened into the array at
 *                     that path.
 *
 * Compile-time discriminator types enforce mutual exclusion;
 * `DAGDeriver.derive` re-validates at runtime as a defensive backstop.
 */
export type DAGDeriverScatterType = DAGDeriverScatterBase & (
  | { strategy: 'custom';    customNode: string;
      partitions?: never;    target?: never }
  | { strategy: 'partition'; partitions: Record<string, string>;
      customNode?: never;    target?: never }
  | { strategy: 'append';    target: string;
      customNode?: never;    partitions?: never }
);

/**
 * Progressive key typing: resolves to `keyof T & string` when `T` is a concrete
 * state subtype (the caller passed an explicit `TChildState`), or to `string`
 * when `T = NodeStateInterface` (the default). Authoring untyped keeps loose
 * `string` keys; passing the child state type narrows to its real keys.
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
 * state at compile time. Omitting `TChildState` (the default
 * `NodeStateInterface`) leaves both sides as loose `string`.
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
 *     } satisfies DAGDeriverEmbeddedDAGType<ChildState>,
 *   },
 * }
 * ```
 */
export type DAGDeriverEmbeddedDAGType<TChildState extends NodeStateInterface = NodeStateInterface> = {
  /** Registered DAG name to invoke as the embedded-DAG. */
  dag: string;
  /**
   * Optional state mapping copied into / out of the child execution.
   * Mirrors `EmbeddedDAGNode.stateMapping` in the engine.
   *
   * When `TChildState` is a concrete subtype:
   *   - `input` keys are narrowed to `keyof TChildState & string`; a
   *     compile-time error is raised for unknown child-state keys.
   *   - `output` values are narrowed to `keyof TChildState & string`.
   *
   * When `TChildState` is the default `NodeStateInterface`, both sides
   * accept any `string`.
   *
   * The wire shape written to the rendered `EmbeddedDAGNode` is always
   * `Record<string, string>`; the generic is for authoring ergonomics only.
   */
  stateMapping?: {
    /** Child-state key → parent dotted path. */
    input?:  Partial<Record<ChildKey<TChildState>, string>>;
    /** Parent dotted path → child-state key. */
    output?: Partial<Record<string, ChildKey<TChildState>>>;
  };
  /**
   * Output ports the embedded-DAG can route on. Each port auto-wires to
   * the next derived stage; `DAGDeriverAnnotationsType.terminals` overrides
   * individual ports.
   */
  outputs: string[];
}

/**
 * Annotations consumed by `DAGDeriver.derive`. All fields are
 * optional; when all are absent every operation renders as a
 * `SingleNode` with `success` routing to the next derived operation.
 */
export type DAGDeriverAnnotationsType = {
  terminals?:   Record<string, DAGDeriverTerminalType[]>;
  scatters?:    Record<string, DAGDeriverScatterType>;
  embeddedDAGs?: Record<string, DAGDeriverEmbeddedDAGType>;
}
