/**
 * FlowAnnotations — declarative hooks for routing the contract-derived
 * flow cannot express by data-graph alone.
 *
 *   terminals — alternate exit outputs that terminate the flow rather
 *               than continuing into the next derived stage. Useful for
 *               operations whose non-success outcomes route to `null`.
 *   fanouts   — operations whose data-graph successor is reached by
 *               fan-out over a state-array source. Specifies the source
 *               path, the per-item key, the concurrency cap, the
 *               fan-in node, and the fan-out outcome names.
 *   subDAGs   — operations that delegate execution to a nested
 *               registered DAG. Renders as a `DeepDAGNode` placement
 *               with the supplied `dag` name and optional state
 *               mapping. Every port in `outputs` auto-wires to the
 *               next derived stage; `terminals` overrides per-port.
 */

/** Per-operation alternate exit. `target: null` ends the flow. */
export interface FlowTerminal {
  readonly outcome: string;
  readonly target: string | null;
}

/** Per-operation fan-out wrapping. */
export interface FlowFanOut {
  /** Dotted path on state to the source array. */
  readonly source: string;
  /** Metadata key the per-item executions read for the current item. */
  readonly itemKey: string;
  /** Concurrency cap; defaults to source array length when omitted. */
  readonly concurrency?: number;
  /** Registered node name invoked as the fan-in custom strategy. */
  readonly fanInOperation: string;
  /** Fan-out outcome names. The dispatcher routes on these names. */
  readonly outcomes: readonly string[];
}

/**
 * Per-operation sub-DAG composition. The operation's contract still
 * declares `produces ↔ hardRequired` for topology derivation; the
 * annotation only swaps the rendered placement from `SingleNode` to
 * `DeepDAGNode`.
 */
export interface FlowDeepDAG {
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
   * the next derived stage; `FlowAnnotations.terminals` overrides
   * individual ports.
   */
  readonly outputs: readonly string[];
}

/**
 * Annotations consumed by `FlowDeriver.derive`. All fields are
 * optional; when all are absent every operation renders as a
 * `SingleNode` with `success` routing to the next derived operation.
 */
export interface FlowAnnotations {
  readonly terminals?: Readonly<Record<string, readonly FlowTerminal[]>>;
  readonly fanouts?:   Readonly<Record<string, FlowFanOut>>;
  readonly subDAGs?:   Readonly<Record<string, FlowDeepDAG>>;
}
