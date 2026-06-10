/**
 * WebWorkerLike: structural contracts for the Web Worker boundary.
 *
 * No DOM lib. All browser shapes are structural (duck-typed) interfaces
 * defined here so the package compiles and tests in Node.js without
 * any browser globals. Consumers cast real Worker / self references
 * at THEIR boundary via `as WebWorkerLikeInterface` — this package
 * never touches window, self, or DOM types.
 *
 * Two concepts:
 *   WebWorkerLikeInterface  — the outside-worker (main-thread) view: a
 *                              spawnable, terminatable worker endpoint.
 *   WorkerScopeLikeInterface — the inside-worker (global scope) view:
 *                              a message-posting, message-receiving scope.
 */

// ---------------------------------------------------------------------------
// WebWorkerLikeInterface
// ---------------------------------------------------------------------------

/**
 * Structural interface for a Web Worker as seen from the main thread.
 *
 * Minimal surface: the three operations a WebWorkerContainer pool requires.
 * The message event carries a `data` property (structuredClone payload).
 */
export interface WebWorkerLikeInterface {
  /** Send a message to the worker. Fire-and-forget. */
  postMessage(message: unknown): void;
  /**
   * Subscribe to 'message' events from the worker.
   * The listener receives a message event whose `data` property is the
   * payload delivered via the worker's `postMessage`.
   */
  addEventListener(
    type: 'message',
    listener: (event: { 'data': unknown }) => void,
  ): void;
  /**
   * Subscribe to 'error' events from the worker — the death signal a Web
   * Worker emits when it throws an uncaught exception or fails to load. This
   * is the browser equivalent of a worker_threads 'error'/'exit': the parent
   * uses it as the crash-detection backstop (Law 4) to fail in-flight requests
   * instead of hanging forever.
   *
   * Structural and minimal: the listener receives an event with an optional
   * `message` string. No DOM `ErrorEvent` lib dependency — the real
   * `Worker.addEventListener('error', …)` is structurally assignable because
   * `ErrorEvent` carries a `message: string`.
   */
  addEventListener(
    type: 'error',
    listener: (event: { 'message'?: string }) => void,
  ): void;
  /** Terminate the worker; no further messages are delivered. */
  terminate(): void;
}

// ---------------------------------------------------------------------------
// WorkerScopeLikeInterface
// ---------------------------------------------------------------------------

/**
 * Structural interface for the inside-worker global scope.
 *
 * Minimal surface: the two operations a worker-side entry point requires —
 * post messages outward and receive messages inward.
 */
export interface WorkerScopeLikeInterface {
  /** Send a message to the main thread. Fire-and-forget. */
  postMessage(message: unknown): void;
  /**
   * Subscribe to 'message' events from the main thread.
   * The listener receives a message event whose `data` property is the
   * payload delivered via the main thread's `postMessage`.
   */
  addEventListener(
    type: 'message',
    listener: (event: { 'data': unknown }) => void,
  ): void;
}
