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
 * Annotations consumed by `FlowDeriver.derive`. Both fields are
 * optional; when both are absent every operation runs in topo order
 * with `success` routing to the next derived operation.
 */
export interface FlowAnnotations {
  readonly terminals?: Readonly<Record<string, readonly FlowTerminal[]>>;
  readonly fanouts?: Readonly<Record<string, FlowFanOut>>;
}
