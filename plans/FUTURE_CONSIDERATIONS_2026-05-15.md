# Dagonizer — Future Considerations (post-2026-05-15 cleanup)

Items surfaced during the 2026-05-15 backbone-readiness review that are
**deferred** until `CLEANUP_2026-05-15.md` lands. Captured here so they
are not lost; not binding.

## Explicitly rejected for the current cycle

### Middleware adapter (review item 9)

Status: **REJECTED.**

Rationale: Dagonizer is a DAG dispatcher. A koa-style middleware engine is
a degenerate linear DAG with one output per task. Consumers who want
middleware should use middleware. Shipping a `wrapMiddleware` adapter in
this release would invite the wrong mental model and pollute the surface.

If a future consumer needs interop, the path is to model their middleware
chain as a linear DAG — not to add an adapter.

### `ConcurrentDispatcher` (review item 11)

Status: **REJECTED.**

Rationale: bounded-concurrency execution of one DAG across many root
states is a fan-out shape. If `fan-out` cannot express it cleanly, fix
fan-out — do not add a parallel orchestration tier.

Open question (audit before declaring this fully closed): can a top-level
fan-out over a `roots` array, where each item's node is the entire DAG
under test, currently express "process N independent root states with
bounded concurrency"? If not, the cleanup is a `sub-dag` enhancement
(allow the source array to drive the sub-DAG's initial state), not a new
class.

## Cases not yet considered (deferred for prioritization)

These came out of the consumer-fit analysis (nocturne, iridis, ripperoni,
squashage). Each is real; each waits its turn.

### State-agnostic mode

Iridis's `Engine` runs against a plain object, not a class with FSM
lifecycle. Forcing every consumer to subclass `NodeStateBase` for a six-
step linear pipeline is overweight.

Sketch: a second `NodeInterface` shape that does not require
`NodeStateInterface` — consumers pass a plain object, the dispatcher
supplies a tiny internal state-tracker just for cancellation/lifecycle.
Or split `Dagonizer` into a thin `LinearDispatcher` and the existing
full-fat `Dagonizer`.

### Lifecycle-attached tasks

Iridis runs tasks at `onRunStart` / `onRunEnd` — they are not in the main
flow but participate as registered units of work. Dagonizer's `on*` hooks
are observability only.

Sketch: a `phase: 'pre' | 'main' | 'post'` slot on node placements, or a
`PhaseNode` placement type that the dispatcher invokes around the main
loop. Composes with the existing extend-only observability.

### Plugin self-registration sugar

Ripperoni's `TaskRegistry.load(path)` lets a plugin file `import './my-
plugin.js'` and have its tasks self-register at module load. Dagonizer's
`dispatcher.registerNode` is per-instance, which is more correct but
heavier for plugin-driven projects.

Sketch: `Dagonizer.registerPlugin({ nodes, dags })` accepts a coherent
bundle. Plugin file exports a single function returning the bundle; host
code calls `dispatcher.registerPlugin(myPlugin())` once.

### Cancellation telemetry

When an abort fires, `state.lifecycle` records the kind but the caller
cannot tell *which node was running* at the moment of the abort. Add to
`ExecutionResultInterface`:

```ts
interruptedAt: { nodeName: string; reason: 'abort' | 'timeout' } | null
```

### Resumable fan-out

`Checkpoint.from` saves `cursor + executedNodes + skippedNodes`, but a
fan-out half-complete is opaque to checkpoint. Resuming re-executes every
item. For long-running fan-outs (Ripperoni, Squashage) this is wasteful.

Sketch: per-item progress bookkeeping inside the fan-out node (item index,
already-completed indices), surfaced through `state.metadata` under a
reserved key, restored on `resume`.

### Checkpoint schema migration

`CheckpointDataSchema` carries a `version` field but there is no
migration path. When v2 lands, what happens to v1 checkpoints?

Sketch: a `CheckpointMigrator` static class that maps `v1 -> v2 -> v3`,
applied transparently inside `Checkpoint.recall`.

### Per-stage tracing

Beyond observability hooks: emit OpenTelemetry-shaped span events per
node so consumers using OTel get a flow trace without writing the
exporter themselves. Optional, off by default, gated behind an
`instrumentation` adapter contract.

### Distributed dispatcher

Today the dispatcher is in-process. A future "Dagonizer Cluster" mode
would run nodes on remote workers via a transport adapter. Out of scope
indefinitely; flagged here so the abstraction does not accidentally close
the door.

## Review process

When the cleanup phases land, reopen this document. Re-rank by:

1. Active consumer demand (who actually needs it).
2. Cost of the workaround they would otherwise build.
3. Surface-area expansion (a feature is cheaper if it slots into existing
   primitives than if it requires a new tier).
