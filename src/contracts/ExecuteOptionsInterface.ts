/**
 * Options accepted by `execute` / `resume` for cancellation and deadline
 * enforcement.
 */
export interface ExecuteOptionsInterface {
  'signal'?: AbortSignal;
  'deadlineMs'?: number;
}
