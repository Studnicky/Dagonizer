---
seeAlso:
  - text: 'Reference: Execution'
    link: './execution'
  - text: 'Reference: Dagonizer'
    link: './dagonizer'
    description: 'observability hooks'
---

# Lifecycle

`@studnicky/dagonizer/lifecycle`

The lifecycle module exports the discriminated union type, the event union type, and the pure reducer machine.

---

## Type: `DAGLifecycleStateType`

```ts twoslash
import type { DAGLifecycleStateType } from '@studnicky/dagonizer/lifecycle';
```

Discriminated union of the six states a DAG lifecycle can occupy:

```ts twoslash
import type { DAGLifecycleStateType } from '@studnicky/dagonizer/lifecycle';
// DAGLifecycleStateType is:
//   | { variant: 'pending';   startedAt: null;   finishedAt: null;   error: null;  reason: null }
//   | { variant: 'running';   startedAt: number; finishedAt: null;   error: null;  reason: null }
//   | { variant: 'completed'; startedAt: number; finishedAt: number; error: null;  reason: null }
//   | { variant: 'failed';    startedAt: number; finishedAt: number; error: Error; reason: null }
//   | { variant: 'cancelled'; startedAt: number; finishedAt: number; error: null;  reason: string }
//   | { variant: 'timed_out'; startedAt: number; finishedAt: number; error: null;  reason: null }
const _check: DAGLifecycleStateType = {} as DAGLifecycleStateType;
```

All timestamps are monotonic milliseconds from `Clock.monotonicMs()`. They are relative-time values suitable for duration math, not wall-clock display.

Inspect via `state.lifecycle.variant`. Narrow to a terminal variant to access its payload:

<<< @/../examples/the-archivist/runArchivist.ts#lifecycle-state-switch

---

## Type: `DAGLifecycleEventType`

Events consumed by `DAGLifecycleMachine.transition()`.

```ts twoslash
import type { DAGLifecycleEventType } from '@studnicky/dagonizer/lifecycle';
// DAGLifecycleEventType is:
//   | { type: 'start';   at: number }
//   | { type: 'succeed'; at: number }
//   | { type: 'fail';    error: Error; at: number }
//   | { type: 'cancel';  reason: string; at: number }
//   | { type: 'timeout'; at: number }
const _check: DAGLifecycleEventType = {} as DAGLifecycleEventType;
```

The `at` field carries the monotonic clock value for the transition. Supply `Clock.monotonicMs()` in production; supply a pinned value in tests for determinism.

---

## Class: `DAGLifecycleMachine`

Pure reducer for `DAGLifecycleState`. Static class; never instantiated.

```ts twoslash
import { DAGLifecycleMachine } from '@studnicky/dagonizer/lifecycle';
```

### `DAGLifecycleMachine.initial()`

```ts twoslash
import { DAGLifecycleMachine } from '@studnicky/dagonizer/lifecycle';
// ---cut---
const initial = DAGLifecycleMachine.initial();
// Returns: { variant: 'pending', startedAt: null, finishedAt: null, error: null, reason: null }
```

Seed value for a new state object.

### `DAGLifecycleMachine.transition(state, event)`

```ts twoslash
import { DAGLifecycleMachine } from '@studnicky/dagonizer/lifecycle';
import type { DAGLifecycleStateType, DAGLifecycleEventType } from '@studnicky/dagonizer/lifecycle';
// ---cut---
declare const state: DAGLifecycleStateType;
declare const event: DAGLifecycleEventType;
const next: DAGLifecycleStateType = DAGLifecycleMachine.transition(state, event);
```

Pure reducer. Returns a new state for legal transitions, returns the input state **by reference** for illegal transitions (which `NodeStateBase.dispatch` detects and converts to `DAGError`).

Terminal states (`completed`, `failed`, `cancelled`, `timed_out`) return themselves unchanged for all events. Terminal stickiness.

Valid transitions:

| From | Event | To |
|------|-------|----|
| `pending` | `start` | `running` |
| `running` | `succeed` | `completed` |
| `running` | `fail(error)` | `failed` |
| `running` | `cancel(reason?)` | `cancelled` |
| `running` | `timeout` | `timed_out` |

All other transitions return the input unchanged (illegal, detected by `NodeStateBase`).

### `DAGLifecycleMachine.isTerminal(state)`

`true` if the state is one of `completed`, `failed`, `cancelled`, or `timed_out`.

```ts twoslash
import { DAGLifecycleMachine } from '@studnicky/dagonizer/lifecycle';
import type { DAGLifecycleStateType } from '@studnicky/dagonizer/lifecycle';
// ---cut---
declare const lifecycle: DAGLifecycleStateType;
if (DAGLifecycleMachine.isTerminal(lifecycle)) {
  // flow has ended
}
```

---

## Usage in custom state

Callers implementing `NodeStateInterface` without extending `NodeStateBase` use `DAGLifecycleMachine` directly to drive lifecycle transitions:

```ts twoslash
import { DAGLifecycleMachine } from '@studnicky/dagonizer/lifecycle';
import type { DAGLifecycleStateType } from '@studnicky/dagonizer/lifecycle';
import { Clock } from '@studnicky/dagonizer/runtime';
// ---cut---
let lifecycle: DAGLifecycleStateType = DAGLifecycleMachine.initial();

function markRunning(): void {
  const next = DAGLifecycleMachine.transition(lifecycle, { type: 'start', at: Clock.monotonicMs() });
  if (next === lifecycle) throw new Error('Cannot mark running');
  lifecycle = next;
}
```
## Related guides

- [Cancellation](../guide/cancellation)
- [Observability](../guide/observability)
- [Subclassing State](../guide/subclassing)
