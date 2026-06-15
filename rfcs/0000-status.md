# Plural-Native Rewrite — Status & Handoff (read this first)

This is the entry point for continuing the plural-native engine rewrite in a fresh
session. Read this, then the three RFCs it indexes. Everything an implementation
agent needs to avoid going off the rails is here or in the linked RFCs.

## The RFCs (design + per-sub-wave implementation detail)

- **`0001-plural-native-core.md`** — the overall plan. The batch contract
  (`Batch`/`Item`/`RoutedBatch`), `ScalarNode`, the one-fold gather, row-oriented
  state, no-shims/one-contract, the consumer-migration order, Phases 1–5.
- **`0002-reservoir-scatter.md`** — the reservoir. NOTE: §2's "DAG bodies iterate
  per item" is **superseded by 0003** (DAG bodies become batch-native). The
  reservoir config surface (schema/builder/validation) is built; its *behavior* is
  now a "firing policy" delivered inside 0003.
- **`0003-batch-native-walk.md`** — the executor heart and the next major work. The
  walk becomes a batch dataflow (frontier of `placement → batch`, fire/partition/
  merge). Firing policy is the one knob; the reservoir is the capacity-triggered
  firing policy. Has resolved §10 decisions and a 6-sub-wave build order. **Start
  here for the next phase.**

## Non-negotiable principles (decided this session — do not relitigate)

1. **One contract, no shims.** `NodeInterface.execute(batch) → RoutedBatch` is the
   only node contract. No legacy `execute(state)`, no `PLURAL` brand, no adapter
   that detects "old" nodes. (`NodeRunner` is a thin `node.execute(batch)` call.)
2. **Single-item = internal iteration, not a second contract.** A per-item node
   extends `ScalarNode` (implements `executeOne`, base loops the batch). A DAG given
   a batch processes it via the batch-native walk (0003) — same contract as a node.
   "A scalar is a batch of 1" holds everywhere.
3. **Row-oriented batches.** A batch is `Item<TState>[]` (per-item states). No
   columnar/SoA. `ScalarNode` is mechanical precisely because the unit is a row.
4. **Routing is partitioning.** A node maps a batch to `Map<output, Batch>`. This
   unifies per-item routing, micro-batching, and the reservoir.
5. **Gather is one fold.** `seed → reduce(batch) → finalize`. No
   `apply`/`applyIncremental` split, no `IncrementalGatherStrategy`. "Incremental"
   is a batch of 1; "all-at-once" is a batch of N — same `reduce`.
6. **Reservoir = a firing policy, not a placement or a scatter bolt-on.** Default
   firing = "fire when upstream drained" (the implicit reservoir); reservoir config =
   "fire at capacity/idle/complete." (0003 §3.)
7. **Distinct batch-firing events.** `onFire(placement, batch, …)` /
   `onFired(placement, routedBatch, …)` / `onError(placement, error, batch, …)`.
   The single-item `onNodeStart`/`onNodeEnd` are removed, not overloaded.
8. **Checkpoint = full serialization** of in-flight state (frontier, reservoir
   buffers); resume is byte-equivalent. No flush-before-checkpoint shortcut.
9. **Parity gate.** Every executor change keeps a size-1 input byte-identical to the
   prior behavior; the existing dagonizer test suite stays green at every step.
10. **Out of scope by decision:** columnar state; distributed multi-host shuffles
    (composed later from routing + handoff + reservoir, see 0001 §14); a SQL surface.

## Current baseline (as-built, all in the dagonizer package, GREEN)

Verified: `npm run typecheck` clean, `npm run lint -- --max-warnings 0` clean,
`npm run test` → **756 pass / 0 fail**, `npm run build` clean. **Nothing is committed**
(see "First actions" below).

Built and green:
- **Phase 1a** — `src/core/batch/{Item,Batch,RoutedBatch}.ts`
  (`Batch.of/empty/from/size/map/filter/partition/concat/ids/row/items/[iterator]`,
  `RoutedBatchBuilder`), `src/core/ScalarNode.ts` (`executeOne` → batch loop, forwards
  errors via `state.collectError`), `src/core/NodeRunner.ts` (thin
  `node.execute(batch)`). Exports wired through root + `./core` + `./contracts` +
  `./types`.
- **Phase 1b** — `NodeInterface.execute(batch) → RoutedBatch` is the one contract;
  `PluralNodeInterface`/`PLURAL` deleted; executor invokes nodes via
  `#runNodeOnState` (wraps `Batch.of(state)`, asserts size-1 invariant, returns the
  one route); `MonadicNode`, the conformance harness, and all dagonizer test nodes
  migrated to the contract.
- **Phase 2a** — `GatherStrategy` reified to `seed`/`reduce(config, batch, state,
  accessor)`/`finalize`; `IncrementalGatherStrategy`/`apply`/`applyIncremental`
  removed; six built-ins migrated (`map/append/partition/collect/discard/custom`);
  the scatter executor calls seed → reduce(`Batch.of(record)`) per clone → finalize.
- **RFC 0002 sub-wave 1** — `reservoir` JSON-schema block on `ScatterNode`, the
  `reservoir?` option in `DAGBuilder.scatter` (conditional spread), and
  `DAGValidator.validateReservoir`. **Config only — no executor behavior** (the
  partial executor attempt was reverted; the executor processes one item per
  dispatch, post-2a).

Not built (and intentionally so): the reservoir runtime, the batch-native walk,
consumer migration, the Cartographer adoption.

## State of the rest of the repo (expected, not a bug)

The contract cutover means **every consumer is red** against `execute(batch)` —
the adapters, tools, embedders, patterns, executor packages, and the examples
(archivist + cartographer demos do not run). This is by design (0001 §9: the
workspace-wide `ci` is green only once the last consumer migrates in Phase 3). Do
not "fix" consumers ad hoc; migrate them in Phase 3 order.

Earlier this session the Cartographer was also redesigned at the example level
(four intake formats csv/json/ndjson/yaml, orthogonal gzip, per-shape normalization
sub-DAGs, configurable per-format mix). That work is intact and will be reconciled
during Phase 4 (Cartographer adoption) on top of the new engine — it is not
throwaway.

## Build order from here

1. **0003 batch-native walk** (the executor heart), sub-waves in `0003-batch-native-walk.md` §9:
   1. Frontier scheduler over acyclic DAGs (drained firing, topo-rank), size-1 parity exact.
   2. Cycles/retry (back-edges re-enter, re-batch).
   3. Reservoir as a firing policy (wire the 0002 config to capacity/idle/complete).
   4. Embedded-DAG + scatter integration under the frontier model.
   5. Checkpoint of the frontier + resume parity.
   6. Viz (per-firing batch size; reservoir glyph + per-key fill).
2. **0001 Phase 3** — migrate consumers in order: executors → patterns →
   adapters/tools/embedders → examples (mostly `ScalarNode` base-swaps; hot nodes
   hand-write `execute(batch)`). Each package goes green as migrated.
3. **0001 Phase 4** — Cartographer adoption: reservoir firing at the route
   decisions, batch route-processor nodes (Batch<N> + LRU services), async streaming
   source (1k–1M), web-worker enrichment (`executor-web`), throughput/progress/
   sliding-window UI.
4. **0001 Phase 5** — docs/concepts (plural-native, reservoir, migration guide).

## How implementation agents must work (rails)

- **Verify in the dagonizer package** with: `cd packages/dagonizer && npm run
  typecheck && npm run lint -- --max-warnings 0 && npm run test && npm run build`.
  Report exact test counts. The package suite is the gate per-wave.
- **Parity is sacred.** A size-1 input must behave byte-identically to the prior
  step. If an existing test changes meaning, that is a red flag — investigate, don't
  just edit the test to pass.
- **Stop at sub-wave boundaries** for review (the coordinator reviews diffs + runs
  the suite; do not trust an agent's "done").
- **Worktree caveat:** the `typescript` agent type may run in
  `.claude/worktrees/...`. If so, the coordinator copies the new files into the main
  tree, re-verifies, and prunes the worktree (the worktree forks from HEAD and lacks
  this session's uncommitted work).
- **Do not commit** unless explicitly told. **Do not** touch other packages/examples
  outside the current phase.
- Schema-as-source-of-truth (types via `FromSchema`), no `any`/`@ts-ignore`, V8 shape
  stability, present-tense comments, named exports, no canonical-type aliasing.

## First actions for the next session

1. **Commit the green baseline first.** Everything is uncommitted; a fresh session
   should not inherit a large entangled working tree. With the user's go-ahead,
   commit the current green dagonizer state (Phases 1a/1b/2a + RFC-0002 sub-wave-1)
   on a feature branch as the checkpoint to build on — so any later revert (like the
   one that was just needed for the broken sub-wave-2 attempt) has a real baseline.
2. Then build **0003 sub-wave 1** (frontier scheduler, acyclic, size-1 parity).
