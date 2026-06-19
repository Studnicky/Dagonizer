/**
 * ObserverRelayInterface: callbacks the parent `Dagonizer` injects into a container so
 * worker-side hook events flow back to the parent's protected hooks.
 *
 * A container implementation receives an `ObserverRelayInterface` and forwards the
 * node/phase/error events its worker sub-DAGs emit. `onFlowStart`/`onFlowEnd`
 * are absent: those are top-level concerns owned by the parent's `execute()`
 * call. The relay carries only the node/phase/error hooks that worker sub-DAGs
 * need to forward.
 *
 * Pure structural contract (no engine import) so `contracts/` modules and the
 * container surface can reference it without reaching up into `Dagonizer.ts`.
 * `Dagonizer` constructs the concrete relay; consumers receive this type.
 */
export interface ObserverRelayInterface {
  /** A worker node began. `placementPath` is the nesting path from the root DAG to the node. */
  onNodeStart(nodeName: string, placementPath: readonly string[]): void;
  /** A worker node finished. `output` is the routing output it resolved to, or `null` when none. */
  onNodeEnd(nodeName: string, output: string | null, placementPath: readonly string[]): void;
  /** A worker node raised an error. `placementPath` locates the node within the nested DAGs. */
  onError(nodeName: string, error: Error, placementPath: readonly string[]): void;
  /** A worker DAG entered its pre/post lifecycle phase at the given placement. */
  onPhaseEnter(dagName: string, phase: 'pre' | 'post', placementName: string, placementPath: readonly string[]): void;
  /** A worker DAG exited its pre/post lifecycle phase at the given placement. */
  onPhaseExit(dagName: string, phase: 'pre' | 'post', placementName: string, placementPath: readonly string[]): void;
}
