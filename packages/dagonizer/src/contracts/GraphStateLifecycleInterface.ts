/** Lifecycle hook for graph-backed state to close its active run graph. */
export interface GraphStateLifecycleInterface {
  closeGraph(closedAt?: string): void;
}
