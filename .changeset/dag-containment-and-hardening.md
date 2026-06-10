---
"@noocodex/dagonizer": major
---

DAG containment, cross-host hand-off, crash-safe transport, and a full audit-and-harden pass.

**Features**
- DAG containment: run a whole sub-DAG inside a worker / child-process / web-worker isolate via a `container` placement key. Two new executor packages (`dagonizer-executor-node`, `dagonizer-executor-web`).
- Cross-host hand-off (`HandoffChannelInterface` + `DAGHandoff`) and crash-safe transport (single-subscription correlation, death backstop, at-least-once delivery). Worker-pool lifecycle owned by `DagContainerBase`. Per-container-role viz colors.

**Breaking — opinionated surface**
- Removed `ParallelNode` (scatter+gather is the only fan-out), implicit null-route terminals (explicit `TerminalNode` only), and the Instrumentation plugin (subclass hooks are the only observability).
- Removed all back-compat aliases/shims: `SchedulerHandle`, `PhaseNodePlacementInterface`, `TerminalNodePlacementInterface`, `StateRestoreFnType`. `AdapterBase` → `BaseAdapterCore`.
- `Store.connect`/`disconnect` required (no-op defaults in `BaseStore`); `StoreError extends DAGError`; `runDag(task, options?)`.

**Breaking — reified `Timeout`**
- `Timeout` value object (`Timeout.none()` / `Timeout.ofMs(n)` / `Timeout.fromWire(n)`) replaces the ad-hoc `number | undefined | 0 | null` per-node and per-DAG-task timeout representations. `NodeInterface.timeout?: Timeout`, `MonadicNode.timeout`, `DagTask.timeout`. The `ExecutionRequest`/`BridgeMessage` wire stays `number | null`.

**Breaking — type-shape conventions**
- Canonical defaults: every options/config bag resolves through a co-located defaults object applied as both the default argument and a spread over caller input; defaulted fields are optional input, never required-of-caller.
- Data-shape types are mutable: `readonly`/`ReadonlyArray`/`Readonly<Record>` removed from entity, wire, and options/config declarations to match the schema-derived shapes. Consumers apply `Readonly<>` at their boundary; class instance fields and `as const` schema literals keep their immutability. Compile-time only.

Dispatch maps replace switch chains throughout; schema-as-source-of-truth gaps closed; all workspace consumer packages migrated. Validation: typecheck + lint clean, 698 dagonizer tests pass, every workspace package and example builds.
