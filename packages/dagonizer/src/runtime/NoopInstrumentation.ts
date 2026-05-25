import type { Instrumentation } from '../contracts/Instrumentation.js';
import type { ExecutionResultInterface } from '../entities/execution/ExecutionResult.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

/**
 * No-op base — the default `Dagonizer.instrumentation`. Plugins
 * extend this and override only the hooks they care about; every
 * un-overridden hook stays a no-op.
 */
export class NoopInstrumentation<TState extends NodeStateInterface = NodeStateInterface>
implements Instrumentation<TState> {
  flowStart(_dagName: string, _state: TState): void { /* no-op */ }
  flowEnd(_dagName: string, _state: TState, _result: ExecutionResultInterface<TState>): void { /* no-op */ }
  nodeStart(_dagName: string, _nodeName: string, _state: TState, _placementPath: readonly string[]): void { /* no-op */ }
  nodeEnd(_dagName: string, _nodeName: string, _output: string | undefined, _state: TState, _placementPath: readonly string[]): void { /* no-op */ }
  phaseEnter(_dagName: string, _phase: 'pre' | 'post', _placementName: string, _state: TState, _placementPath: readonly string[]): void { /* no-op */ }
  phaseExit(_dagName: string, _phase: 'pre' | 'post', _placementName: string, _state: TState, _placementPath: readonly string[]): void { /* no-op */ }
  contractWarning(_message: string): void { /* no-op */ }
  error(_dagName: string, _nodeName: string, _error: Error, _state: TState, _placementPath: readonly string[]): void { /* no-op */ }
}
