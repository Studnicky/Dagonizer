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
 *                      placements inside parallel / fan-out / deep-DAG)
 *   nodeEnd          — after the node's result is recorded
 *   phaseEnter       — before a pre/post phase placement runs
 *   phaseExit        — after a pre/post phase placement runs
 *   contractWarning  — non-fatal dangling-write warning from derive
 *   error            — any thrown error the dispatcher catches
 *
 * Implementations MUST NOT throw — exceptions surfacing through the
 * hook will abort the flow. Wrap any I/O (HTTP exporters, file writes)
 * in try/catch internally.
 */
export interface Instrumentation<TState extends NodeStateInterface = NodeStateInterface> {
  flowStart(dagName: string, state: TState): void;
  flowEnd(dagName: string, state: TState, result: ExecutionResultInterface<TState>): void;
  nodeStart(dagName: string, nodeName: string, state: TState): void;
  nodeEnd(dagName: string, nodeName: string, output: string | undefined, state: TState): void;
  phaseEnter(dagName: string, phase: 'pre' | 'post', placementName: string, state: TState): void;
  phaseExit(dagName: string, phase: 'pre' | 'post', placementName: string, state: TState): void;
  contractWarning(message: string): void;
  error(dagName: string, nodeName: string, error: Error, state: TState): void;
}
