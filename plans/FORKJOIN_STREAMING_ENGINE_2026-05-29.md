# Fork-Join Streaming Engine

`@noocodex/dagonizer` becomes a durable streaming dataflow engine: nodes are
streaming operators (async generators), the graph supports arbitrary fork-join
shapes (M / Y / diamond), and execution is deterministically resumable
mid-stream. This is a new runtime (a major version), not a feature on the
current tree-walker.

Decisions taken:
- **A — deep streaming.** Nodes consume and produce item streams, not one-shot
  values. The `NodeInterface` contract changes.
- **B — deterministic resume holds for streaming subgraphs.** Crash mid-stream
  resumes to identical output: no drops, no duplicates, same ordering.

## The constraint that drives the design

JS async generators are not serializable — a suspended `async function*` has no
reachable, snapshotable state. So A (generators) and B (mid-stream resume)
cannot be met by snapshotting node stacks. They are reconciled by the model used
by every durable stream processor (Flink, Kafka Streams):

**Replay + offsets + explicit checkpointed state.**
- Edges are durable, ordered, replayable channels with monotonic offsets.
- Each node commits a consumed-offset (per inbound channel) and produced-offset
  (per outbound channel).
- Node logic is deterministic given (input items + restored explicit state).
- On resume, a node's generator is re-instantiated and fast-forwarded by
  replaying its inbound channel from the last committed offset; downstream
  dedupes by produced-offset (idempotent output).
- Global consistency uses Chandy–Lamport barrier checkpointing: checkpoint
  barriers are injected at sources and flow through the graph; each node
  snapshots its explicit state at barrier alignment; channel offsets commit
  atomically with the snapshot.

The suspended generator is never serialized — it is reconstructed by replay.

## Assets already in the engine

- `NodeStateBase.snapshot()/restore()` — the explicit, serializable per-operator
  state backend.
- `ClockProvider` / `SchedulerProvider` — the injection seam that makes time and
  timers replayable; deterministic replay *requires* all nondeterminism flow
  through these (extended with a record/replay mode).
- `Checkpoint` / `CheckpointStore` — snapshot persistence; extended to carry
  per-channel offsets and barrier epochs.
- Scatter resume (task #8) — the "persist progress, reconstruct on resume"
  discipline; generalizes to channel offsets.
- `GatherStrategies` / `OutcomeReducers` (from the scatter unification) — reused
  as the `barrier`-join reduce step.

## What we adopt from synoma vs build new

Adopt (narrow): async-generator authoring ergonomics; split policies
(broadcast / round-robin / hash / weighted); bounded-channel backpressure
(Node-streams highWaterMark/drain idea, ported to our channels).

Build new (synoma lacks these): the dependency-driven scheduler, the barrier
join, multi-inbound graph edges, and *all* deterministic resume. Synoma's join
is interleave-only (no barrier); its diamond `topology` config is unimplemented;
it has no mid-graph checkpoint. We are not porting fork-join from synoma.

## Architecture

### Graph model
Replace the single `nextStage` pointer with a port-based edge model: each node
declares typed inbound ports and outbound ports; edges connect
`(fromNode, outPort) → (toNode, inPort)`. The DAG document gains an explicit
`edges` array. This is what makes M / Y / diamond expressible.

### Streaming `NodeInterface` (A)
Nodes become operators over streams. Canonical shape:

```ts
interface StreamingNode<TIn, TOut, TState> {
  readonly name: string;
  readonly inPorts:  readonly string[];
  readonly outPorts: readonly string[];
  // Consume per-port input channels; yield (port, item) outputs.
  stream(inputs: PortedInput<TIn>, ctx: StreamContext<TState>): AsyncIterable<PortedOutput<TOut>>;
}
```

One-shot nodes are the degenerate operator that reads its whole input, emits one
item — provided as a base class so existing node logic ports mechanically.

### Channels
Bounded, ordered, replayable. In-memory bounded ring for live flow + a durable
log (the `CheckpointStore` backend) for replay. Backpressure = await-on-full.
Each channel tracks committed read/write offsets.

### Scheduler
Dependency/readiness-driven, replacing the single-cursor walker. Tracks per-node
in-degree over channels; a node is runnable when any inbound port has buffered
items (stream mode) or when all inbound ports closed an epoch (barrier mode).
Concurrency-capped operator execution.

### Fork — `ScatterNode` (split, 1→N)
Pure split: distribute the input stream to N outbound edges by split policy
(broadcast / round-robin / hash / weighted). The current scatter's *clone+run*
becomes "fork to N branches"; the inline gather is removed (see GatherNode).

### Join — `GatherNode` (N→1) with policy
- `barrier` — align all inbound branches per epoch, then reduce via the existing
  `GatherStrategies` + `OutcomeReducers`. This is the fork-join / diamond join.
  The pending-branch set + per-epoch result map fire the reduce when complete.
- `stream` — interleave items as they arrive (synoma-style merge: FIFO /
  round-robin), no barrier. This is streaming fan-in.
`ScatterNode`'s old inline gather is the degenerate immediate-`barrier` case.

### Determinism & resume (B)
- Barrier checkpointing: source operators inject barriers on a configured
  interval/count; barriers flow in-band; each operator snapshots `NodeStateBase`
  + its port offsets at alignment; the `CheckpointStore` commits the snapshot +
  offsets as one epoch.
- Resume: load the latest complete epoch; rehydrate operator states; replay each
  channel from its committed read-offset; dedupe downstream by write-offset.
- Determinism contract (enforced + documented): operator output must be a pure
  function of (inbound items, restored state, injected Clock/Scheduler). All
  nondeterminism (time, randomness, external IO ordering) flows through
  `ClockProvider`/`SchedulerProvider` in record/replay mode. Nodes that violate
  this break exactly-once and are rejected by a determinism lint where
  detectable, documented where not.

## Phasing (each phase ships + reviews independently)

1. **Graph + scheduler (batch first, no streaming yet).** Port-based edges,
   `edges` in the DAG schema, dependency scheduler, `GatherNode(barrier)` reusing
   the reducers. Nodes stay one-shot. Delivers M / Y / diamond with batch
   semantics; resume stays as-is (per-node). No new determinism risk. This alone
   is a large, useful milestone.
2. **Channels + backpressure.** Bounded ordered channels between nodes; convert
   node execution to consume/produce channels (still one-shot operators driving
   whole-channel reads). Backpressure via await-on-full.
3. **Streaming `NodeInterface` (A).** Operators become async generators over
   per-port channels; `GatherNode(stream)` interleave join; one-shot base class
   for migration. Every node + adapter migrates.
4. **Deterministic resume (B).** Durable channel log, barrier checkpointing,
   offset commit, record/replay Clock/Scheduler, output dedup. The hardest phase;
   gated by an adversarial crash-resume test matrix (kill at every barrier
   alignment across diamond/Y/M graphs; assert identical output).
5. **Hardening.** Determinism lint, checkpoint GC/compaction, observability for
   offsets/lag/epochs, docs + examples for fork-join streaming shapes.

## Risks / open constraints

- **Determinism is a node-author contract**, not just engine machinery. The
  engine can enforce Clock/Scheduler routing and dedupe, but a node doing hidden
  IO breaks exactly-once. This must be a documented, linted contract.
- **Checkpoint cost vs latency.** Barrier interval trades resume granularity
  against throughput; needs tuning + per-DAG config.
- **Backpressure + barrier alignment** can deadlock if a barrier is stuck behind
  a full channel; alignment must spill/credit correctly (Flink's known hazard).
- **Scope vs the current value prop.** The tree-walker's simplicity and the
  "consumers extend, never patch" contract change shape. This is a v2 engine; the
  v1 (scatter-unified) line should remain supported during the transition.

## Sequencing

Land the scatter-unification PR first (it is the v1.x major; it is green and a
correct stepping-stone — its `GatherStrategies`/`OutcomeReducers` are reused
here as the barrier reduce). Begin this initiative at Phase 1 on a fresh branch.
Phase 1 is independently valuable (arbitrary DAG shapes, batch) and de-risks the
graph/scheduler before the streaming + resume phases.
