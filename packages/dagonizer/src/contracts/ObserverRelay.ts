/**
 * ObserverRelay: callbacks the parent `Dagonizer` injects into a container so
 * worker-side hook events flow back to the parent's protected hooks.
 *
 * A container implementation receives an `ObserverRelay` and forwards the
 * node/phase/error events its worker sub-DAGs emit. `onFlowStart`/`onFlowEnd`
 * are absent: those are top-level concerns owned by the parent's `execute()`
 * call. The relay carries only the node/phase/error hooks that worker sub-DAGs
 * need to forward.
 *
 * Pure structural contract (no engine import) so `contracts/` modules and the
 * container surface can reference it without reaching up into `Dagonizer.ts`.
 * `Dagonizer` constructs the concrete relay; consumers receive this type.
 */
export interface ObserverRelay {
  onNodeStart(nodeName: string, placementPath: readonly string[]): void;
  onNodeEnd(nodeName: string, output: string | null, placementPath: readonly string[]): void;
  onError(nodeName: string, error: Error, placementPath: readonly string[]): void;
  onPhaseEnter(dagName: string, phase: 'pre' | 'post', placementName: string, placementPath: readonly string[]): void;
  onPhaseExit(dagName: string, phase: 'pre' | 'post', placementName: string, placementPath: readonly string[]): void;
}
