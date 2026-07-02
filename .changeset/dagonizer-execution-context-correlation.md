---
'@studnicky/dagonizer': major
---

`Execution`'s constructor now takes a required second argument, a `@studnicky/context` `ContextScope` (`new Execution(generator, scope)`). `Dagonizer.execute()`/`resume()`/`executeBatch()` build the scope via `DagExecutionContext.initialize({ correlationId, dagName })`, seeding a fresh `crypto.randomUUID()` correlation id and the running DAG's name; `Execution` drives the flow generator's every turn through `scope.execute()` — not a bare `await gen.next()` — so the seeded values propagate through `AsyncLocalStorage` to any node body or lifecycle hook that runs during that turn, at any nesting depth (embedded DAG bodies, scatter items), without being threaded through `NodeContextType`. The scope terminates when the run completes. `resume()` seeds a fresh correlation id rather than reusing the original run's, since a resume runs on a new async call stack.

New `DagExecutionContext` (a module-level `Context` instance) and `DagExecutionContextKeys` (`CORRELATION_ID`, `DAG_NAME`) are exported from `@studnicky/dagonizer/runtime`. Read with `DagExecutionContext.tryGet(key)`, never `get()` — a node's `execute()` may legitimately run outside an active scope (direct invocation, tests), and `tryGet` returns `undefined` rather than throwing.

`ObservedDag`'s lifecycle hooks now include `correlationId` in every structured log entry's `context`, read via `DagExecutionContext.tryGet`; `onNodeStart`/`onNodeEnd`/`onError` additionally include `dagName` from the same context, since the dispatcher does not pass `dagName` as a hook argument at that level.

`package.json` gains `@studnicky/context` as a dependency.
