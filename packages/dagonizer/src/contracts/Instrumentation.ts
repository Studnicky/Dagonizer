import type { ExecutionResultInterface } from '../entities/execution/ExecutionResult.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

/**
 * Hook surface the dispatcher invokes at well-defined execution
 * boundaries. Plugins (`@noocodex/dagonizer-tracing-otel`,
 * custom metrics exporters) implement this to participate without
 * subclassing `Dagonizer`.
 *
 * Every method has a no-op default in `NoopInstrumentation`. Plugins
 * override only the hooks they care about by extending the no-op base
 * class. The dispatcher's own protected `on*` hooks continue to fire
 * for in-subclass observers; the two surfaces coexist.
 *
 * Hook timing:
 *   flowStart        — before the entrypoint node runs
 *   flowEnd          — after the loop drains (terminal or interrupted)
 *   nodeStart        — before each node's execute() call (including
 *                      placements inside parallel / scatter / embedded-DAG)
 *   nodeEnd          — after the node's result is recorded
 *   phaseEnter       — before a pre/post phase placement runs
 *   phaseExit        — after a pre/post phase placement runs
 *   contractWarning  — non-fatal dangling-write warning from derive
 *   error            — any thrown error the dispatcher catches
 *
 * Implementations MUST NOT throw — exceptions surfacing through the
 * hook will abort the flow. Wrap any I/O (HTTP exporters, file writes)
 * in try/catch internally.
 *
 * **`placementPath`** is the ordered array of parent embedded-DAG
 * placement names that led to the current node. It disambiguates same-
 * named inner placements across multiple embedded-DAG instances:
 *   - Top-level node in the root DAG: `[]`
 *   - Inner node inside an `EmbeddedDAGNode` placement `on-topic-search`:
 *     `['on-topic-search']`
 *   - Doubly-nested: `['on-topic-search', 'inner-placement']`
 * The full cytoscape-style id of the current node is
 * `[...placementPath, nodeName].join('/')`.
 */
export interface Instrumentation<TState extends NodeStateInterface = NodeStateInterface> {
  flowStart(dagName: string, state: TState): void;
  flowEnd(dagName: string, state: TState, result: ExecutionResultInterface<TState>): void;
  nodeStart(dagName: string, nodeName: string, state: TState, placementPath: readonly string[]): void;
  nodeEnd(dagName: string, nodeName: string, output: string | null, state: TState, placementPath: readonly string[]): void;
  phaseEnter(dagName: string, phase: 'pre' | 'post', placementName: string, state: TState, placementPath: readonly string[]): void;
  phaseExit(dagName: string, phase: 'pre' | 'post', placementName: string, state: TState, placementPath: readonly string[]): void;
  contractWarning(message: string): void;
  error(dagName: string, nodeName: string, error: Error, state: TState, placementPath: readonly string[]): void;
}
