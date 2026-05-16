# Plan: `@noocodex/dagonizer` toward 1.0

Status: draft for review. Current shipped version: 0.1.0 (lift-and-shift from `nocturne/node/src/lib/dagonizer/`).

This plan absorbs feedback from the first review pass. The chosen runtime patterns (Clock, Scheduler, JSON-Schema-as-source-of-truth, class-extension hooks, RetryPolicy) are described in §2. The JSON-LD / SHACL / PROV-O / IRI-dispatch surface area is out of scope (see §3).

---

## 1. API ergonomics review

Decisions to lock in before publishing — once shipped these are breaking.

### 1.1 `Interface` suffix on every public type — KEEP

Internal noocodec convention. Atypical for npm packages — most consumers expect `FlowConfig` not `FlowConfigInterface`. Two paths:

- **Drop the suffix on exports** (`FlowConfig`, `Operation<TState>`, `ExecutionResult<TState>`, `StageResult<TState>`) while keeping internal file names.
- **Keep as-is** for consistency with the rest of the noocodec ecosystem. ← decided

Outcome: keep. Public surface stays `FlowConfigInterface`, `OperationInterface<TState>`, etc. Consumers outside noocodec live with the suffix. λ canonical-types rule continues to hold.

Notes:

### 1.2 Builder vs. plain-object flow config

Plain-object flow configs stay supported (they're what the schema validates). Adds an opt-in `FlowBuilder` in v0.2 modelled on the existing RDF builder in the `semantics` workspace — chainable, returns the same plain-object `FlowConfigInterface`, no parallel runtime.

```ts
const flow = FlowBuilder.create('demo', '1')
  .entrypoint('classify')
  .stage('classify', classifyOp, { 'on_topic': 'plan', 'off_topic': 'reject' })
  .stage('plan', planOp, { 'success': null })
  .stage('reject', rejectOp, { 'success': null })
  .build();  // → FlowConfigInterface
```

> Cross-ref: `semantics` workspace's RDF builder pattern — same shape, same chainable surface, output is plain data not an object graph.

Notes:

### 1.3 Observability via class extension (no callbacks)

Subclass `Dagonizer` and override `onStageStart`, `onStageEnd`, `onFlowStart`, `onFlowEnd`, `onError`. Default implementations are no-ops. Dispatcher invokes them at the appropriate seams.

```ts
class TracedDagonizer<TState extends OperationStateInterface> extends Dagonizer<TState> {
  protected override onStageStart(stage: string, state: TState): void {
    logger.info({ stage }, 'stage start');
  }
  protected override onStageEnd(stage: string, output: string, state: TState): void {
    logger.info({ stage, output }, 'stage end');
  }
}
```

Class-extension matches the rest of the noocodec ecosystem; callbacks introduce closure coupling and don't compose. Class statics are the noocodec pattern for registries and singletons throughout.

Notes:

### 1.4 Cancellation via `AbortSignal`

`execute()` accepts `{ signal?: AbortSignal, deadlineMs?: number }`. When the signal fires before an operation finishes, the dispatcher dispatches `cancel`/`timeout` on the lifecycle FSM (already encoded — `BaseOperationState.markCancelled`, `.markTimedOut`). Operations receive the signal via a context arg: `execute(state, ctx)` where `ctx = { signal }`.

Deadline is implemented on top of `AbortSignal` — same pattern as retry/backoff. No `setTimeout` scattered through the dispatcher; one `AbortSignal.timeout(deadlineMs)` composed with the caller's signal via `AbortSignal.any([…])`.

Backward-compat: `execute(flowName, state)` (two-arg form) still works — `ctx` is optional.

Notes:

### 1.5 Retry / backoff — IN SCOPE

`RetryPolicy` is a class with strategy enum (`CONSTANT | LINEAR | EXPONENTIAL | DECORRELATED_JITTER`), `retryOn` / `abortOn` filter lists, and `getDelay(attempt, error)`. Drives retry through the same `AbortSignal` plumbing as cancellation.

Retry is per-operation, not per-stage. Operations opt in:

```ts
class FetchOp implements OperationInterface<MyState> {
  readonly name = 'fetch';
  readonly outputs = ['success', 'error'] as const;
  private readonly retryPolicy = new RetryPolicy({ maxAttempts: 3, strategy: 'exponential' });
  async execute(state: MyState, ctx: OperationContext): Promise<OperationResultInterface> {
    return this.retryPolicy.run(() => fetch(...), ctx.signal);
  }
}
```

`RetryPolicy.run()` returns the final result or throws (operations still catch internally and return their error output).

Notes:

### 1.6 Type-safe operation outputs — YES, FULL SAFETY

Narrow `OperationInterface` to parameterize the output union:

```ts
interface OperationInterface<TState, TOutput extends string = string> {
  readonly outputs: readonly TOutput[];
  execute(state: TState, ctx: OperationContext): Promise<OperationResultInterface<TOutput>>;
}

interface OperationResultInterface<TOutput extends string = string> {
  output: TOutput;
  errors?: OperationErrorInterface[];
}
```

`StageConfigInterface.outputs` then takes `Record<TOutput, string | null>` — TypeScript fails the build if a route is missing. Stage configs become generic over the operation's output type. Validation at registration time is preserved as a runtime safety net.

This lands in v0.2 with cancellation — both touch the same surface.

Notes:

---

## 2. Runtime patterns (disciplined seams)

These are the chosen runtime and schema-layer patterns for Dagonizer. Each one enforces a narrow, testable boundary and keeps the package free of heavyweight semantic-web or graph-engine concerns.

### 2.1 Clock + Scheduler singletons (TAKE)

`Clock` and `Scheduler` install pluggable providers behind a static singleton. Every wall-clock read goes through `Clock.now()`. Every timer goes through `Scheduler.current().scheduleAt(...)`. Tests install a `VirtualClock` / `VirtualScheduler` for deterministic time.

For Dagonizer:

- `Clock.now()` / `Clock.hrtime()` for the lifecycle FSM's `startedAt` / `finishedAt` / `cancelledAt` fields (currently `Date.now()` inline).
- `Scheduler.current()` for deadline timers if we don't go pure-`AbortSignal`.
- ~80 LOC each. Bigger payoff than the LOC suggests: full test determinism on time-sensitive paths.

### 2.2 JSON Schema + `json-schema-to-ts` + Ajv (TAKE)

The pattern: **write the JSON Schema once, derive the static TypeScript type with `FromSchema` from `json-schema-to-ts`, compile the runtime validator with Ajv.** No Zod, ever.

```ts
import type { FromSchema } from 'json-schema-to-ts';
import Ajv from 'ajv';

export const FlowConfigSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/FlowConfig',
  'type': 'object',
  'required': ['name', 'version', 'entrypoint', 'stages'],
  'properties': { /* … */ },
  'additionalProperties': false,
} as const;

export type FlowConfig = FromSchema<typeof FlowConfigSchema>;

const ajv = new Ajv({ allErrors: true });
const validateFlowConfig = ajv.compile(FlowConfigSchema);
```

Single source of truth, both gates fired: compile-time via `FromSchema`, runtime via Ajv. Used at every boundary: flow loading from JSON, JSON round-trip, checkpoint persistence.

**Do not use Zod.** Do not invent a runtime helper that wraps json-schema-to-ts. Direct import, direct use.

Workspace note: when the `jsontology` workspace package lands it is meant to replace the json-schema-to-ts + Ajv pair. When it lands, Dagonizer migrates. Until then, json-schema-to-ts + Ajv directly.

### 2.3 `RetryPolicy` as a class (TAKE)

Already covered in §1.5. `RetryPolicy` is a class with strategy enum, `retryOn`/`abortOn` filter lists, and configurable jitter. No `onRetry` callback — operations that want to log retries do it in their own subclass.

### 2.4 Deadline action enum (TAKE selectively)

The only meaningful deadline action is `abort` (driven through `AbortSignal`). Alert/log become caller concerns (subclass hooks). Keep the timing math (`exceededAt`, `duration`); a `DeadlineAction` enum with alert/log variants is not shipped.

### 2.5 Static classes, no free helpers (ALREADY ENFORCED)

Matches noocodec's λ standard. The `no-free-helpers` eslint rule enforces class statics only — worth installing in Dagonizer's eslint config in v0.2.

### 2.6 Schema + interface + validator triplet (TAKE)

Each entity layer follows the same three-part structure:

1. `const FooSchema = { … } as const satisfies AnySchema;`
2. `interface Foo extends JsonObject { … }` (hand-written because json-schema-to-ts emits open index signatures incompatible with strict `JsonObject`)
3. `class FooValidator { static validate(value): value is Foo { … } }` using a module-level pre-compiled Ajv validator.

Apply to: `FlowConfig`, `CheckpointData`, `OperationLifecycleState` (already has the schema in nocturne).

---

## 3. Out of scope

The following directions are not shipped with Dagonizer:

- JSON-LD ingest layer with `@id`/`@type` expansion
- PROV-O lineage / N-quads emission per operation
- SHACL runtime validation
- IRI-keyed dispatch
- Ontology-as-source-of-truth framing / vocabulary files
- Per-channel side-channel stores via a store registry
- Ajv wrapped in an adapter abstraction
- Emission envelope + recorder sink + replay-from-quads

**Persistence:** Dagonizer checkpoints with a cursor (`currentStageName`) plus `OperationStateInterface` snapshot via `structuredClone`. Re-`execute` resumes from the cursor with the persisted state. No quad emission, no recorder sink, no replay layer. The DAG itself is the graph — `executedStages` is the traversal log.

**Distributed execution:** A distributed Dagonizer is just another flow whose stages are sub-flows running on remote workers. The local dispatcher composes them via `sub-flow` stages with state mapping. No new primitive needed.

---

## 4. Updated missing-features matrix

| Feature                                    | Status                                          | Target   | Approach                                                                                   |
| ------------------------------------------ | ----------------------------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| Cancellation via `AbortSignal`             | Lifecycle FSM exists, dispatcher doesn't use it | v0.2     | `execute(name, state, { signal })` + `OperationContext` arg                                |
| Deadline / timeout enforcement             | Same                                            | v0.2     | `AbortSignal.timeout()` composed via `AbortSignal.any()`                                   |
| Type-safe operation outputs                | Loose `readonly string[]`                       | v0.2     | Generic `TOutput extends string` on `OperationInterface`                                   |
| Clock + Scheduler singletons               | Inline `Date.now()`                             | v0.2     | Implement `Clock` / `Scheduler` singletons with pluggable providers (~160 LOC total)        |
| Retry / backoff                            | Out of scope                                    | v0.2     | `RetryPolicy` class, drives `AbortSignal`                                                  |
| Observability via class extension          | Missing                                         | v0.2     | `onStageStart`/`onStageEnd`/`onFlowStart`/`onFlowEnd`/`onError` overridable on `Dagonizer` |
| `FlowBuilder` (chainable authoring)        | Missing                                         | v0.2     | Mirror RDF builder shape from `semantics` workspace                                        |
| Flow JSON Schema + `FromSchema` types      | Missing                                         | v0.3     | Schema + interface + Ajv validator triplet (see §2.6)                                      |
| Flow JSON round-trip (`parse`/`stringify`) | Missing                                         | v0.3     | Validate on load, serialize via `JSON.stringify` (already JSON-safe)                       |
| Checkpoint / resume                        | Missing                                         | v0.4     | Cursor + state snapshot. No RDF, no quads.                                                 |
| Visualization                              | Missing                                         | post-1.0 | Not included yet.                                                                          |
| Distributed execution                      | Out of scope                                    | n/a      | Just another flow.                                                                         |

---

## 5. Test coverage gaps

Current: 20 tests, 8 suites — happy paths + a handful of validation cases.

Missing:

- Fan-in `partition` and `custom` strategies (only `append` is tested).
- Fan-out concurrency cap (test that batches of N execute serially when source > N).
- Error collection across stages (a stage emits errors, dispatcher accumulates, sub-flow bubbles them up).
- `destroy()` cleanup (operations with `destroy` hook are invoked).
- `clone()` semantics on `BaseOperationState` (metadata copies but errors/warnings reset).
- Async iterable cancellation when caller `break`s out of `for await`.
- Lifecycle FSM: `start` from `running` (illegal transition by reference).
- v0.2 additions: `AbortSignal` cancellation, deadline timeout via `VirtualScheduler`, retry policy backoff via `VirtualClock`, type-safe output narrowing compile-fail tests.
- v0.3 additions: flow JSON Schema round-trip, validator rejection cases per malformed flow shape.

Target before 1.0: ~80 tests, branch coverage ≥ 85%.

Notes:

---

## 6. Docs

- **TSDoc** on every exported symbol. Currently sparse — `Dagonizer.execute` has no doc comment, neither do most types.
- **Lexmechanic-generated API reference** (`docs/api/`). Mirrors the noocodec norm.
- **`examples/`** — at least three runnable examples (with `npm run example:NN`):
  - `examples/01-linear/` minimal stage chain
  - `examples/02-fanout/` fan-out + fan-in
  - `examples/03-subflows/` nested flow with state mapping
  - `examples/04-cancellation/` AbortSignal + deadline (v0.2)
  - `examples/05-retry/` RetryPolicy in an operation (v0.2)
  - `examples/06-builder/` FlowBuilder (v0.2)
- **`docs/concepts.md`** — stage kinds, fan-in strategies, lifecycle, when to choose Dagonizer vs. alternatives.

Notes:

---

## 7. CI / quality gates

Following the standards in `~/.claude/CLAUDE.md`:

- `.github/workflows/ci.yml`: typecheck + test + lint on PR.
- Conventional commits + `archivum` hooks (or husky equivalent) — but only if not vendored under noocodec.
- Changelog validator: every PR touching `src/` must update `CHANGELOG.md`.
- Branch protection: `main` requires green CI, no force push.
- ESLint rule: `no-free-helpers` — class statics only, no free functions in `src/`.
- ESLint rule: forbid `Date.now()` / `setTimeout` / `setInterval` outside the Clock/Scheduler internal modules.

Recommendation: `main`-only with PRs for a single-package OSS release.

Notes:

---

## 8. Publishing

- Add explicit `"private": false` and a `repository` field once a remote exists.
- Decide registry: public npm under `@noocodex` scope (requires npm org access).
- Add `prepublishOnly` script running build + test.
- Pin Node ≥ 24 in `engines` (already done).
- Provenance via npm `--provenance` flag once CI publishes.

Notes:

---

## 9. Nocturne migration (separate effort, after v0.1.0 ships)

13 import sites under `nocturne/node/src/`. Sequence:

1. `npm install @noocodex/dagonizer` in nocturne (file link initially: `"@noocodex/dagonizer": "file:../../Dagonizer"`).
2. Replace `from '../lib/dagonizer/index.js'` → `from '@noocodex/dagonizer'` in all 13 files.
3. Delete `nocturne/node/src/lib/dagonizer/`.
4. If `OperationLifecycleMachine` has no other consumers (need to grep), delete `nocturne/node/src/state/operationLifecycle/` and `nocturne/node/src/entities/state-machines/OperationLifecycleState.ts` — let nocturne import from `@noocodex/dagonizer/lifecycle`.
5. If the JSON Schema (`OperationLifecycleStateSchema`) is still needed in nocturne for json-tology, keep it; it's a schema layer that doesn't belong in this package.

Notes:

---

## 10. Roadmap

| Version   | Theme                  | Contents                                                                                                                                                            |
| --------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0.1.0** | Initial port (shipped) | Lift-and-shift from nocturne, lifecycle FSM bundled, 20 tests                                                                                                       |
| **0.1.1** | TSDoc + examples       | Doc-comment every exported symbol, runnable examples 01–03, examples/README, lexmechanic API reference                                                              |
| **0.2.0** | Production essentials  | `AbortSignal` + deadline, `Clock` + `Scheduler` singletons, `RetryPolicy`, class-extension hooks, type-safe `TOutput` generics, `FlowBuilder`. Tests expand to 50+. |
| **0.3.0** | Schema layer           | Flow JSON Schema + `FromSchema` types + Ajv validators (no Zod), JSON round-trip, schema-validated examples                                                         |
| **0.4.0** | Checkpoint / resume    | Cursor + state-snapshot persistence, `dispatcher.resume(snapshot)`, deterministic replay via `VirtualClock`/`VirtualScheduler`                                      |
| **1.0.0** | API freeze             | Documentation site, lexmechanic API reference, branch protection gates, npm publish with `--provenance`                                                             |

---

## 11. Open decisions

Note: `Interface` suffix and observability-via-class-extension are now decided. Remaining open:

1. **v0.2 packaging — single release or split?** Cancellation + Clock/Scheduler is one tight cluster. Retry + type-safe outputs is another. Builder + class-extension hooks is a third. Could ship 0.2 / 0.2.1 / 0.2.2 if the bundle gets unwieldy.
   - Decision:

Yea it all ships together

2. **Examples format — `npm run example:NN` with tsx, or just `node dist-examples/NN.js`?** Recommendation: `npx tsx examples/NN.ts`.
   - Decision:

npx tsx examples/NN.ts

3. **`jsontology` workspace dependency — wait for it, or commit to `json-schema-to-ts` + Ajv directly?** Recommendation: direct now; swap to `jsontology` when it lands.
   - Decision:

Direct now, use jsontology later

4. **Port Clock / Scheduler into `src/runtime/` directly, or vendor as `@noocodec/clock`?** Recommendation: port into `src/runtime/` for v0.2; promote to a shared package only if a second noocodec project needs it.
   - Decision:

Port entirely — dagonizer owns its own versions (copy files directly then adjust into the workspace)

---

## 12. Notes / scratchpad
