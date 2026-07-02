/**
 * DagExecutionContext: per-execution async correlation context.
 *
 * A single `@studnicky/context` `Context` instance, scoped for the lifetime
 * of one `Dagonizer.execute()` / `resume()` call. `Dagonizer` seeds it with a
 * correlation id and the running DAG's name, then drives the flow generator
 * through `ContextScope.execute()` on every turn (see `Execution.ts`) so the
 * seeded values propagate through `AsyncLocalStorage` to every node body and
 * lifecycle hook that runs during that turn — without threading them through
 * `NodeContextType`.
 *
 * Read with `DagExecutionContext.tryGet()`, never `get()`: a node's
 * `execute()` may legitimately run outside an active scope (direct
 * invocation in tests, a bare `node.execute()` call), and `tryGet` returns
 * `undefined` rather than throwing in that case.
 */

import { Context } from '@studnicky/context';

/** Reserved keys stored on `DagExecutionContext`. */
export const DagExecutionContextKeys = {
  'CORRELATION_ID': 'correlationId',
  'DAG_NAME': 'dagName',
} as const;

/** Per-execution async correlation context, shared across the package. */
export const DagExecutionContext: Context = Context.create({ 'name': 'dag-execution' });
