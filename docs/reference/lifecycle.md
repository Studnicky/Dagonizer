---
seeAlso:
  - text: 'Reference: Execution'
    link: './execution'
  - text: 'Reference: Dagonizer'
    link: './dagonizer'
    description: 'observability hooks'
---

# Lifecycle

`@noocodex/dagonizer/lifecycle`

The lifecycle module exports the discriminated union type, the event union type, and the pure reducer machine.

---

## Type: `DAGLifecycleState`

```ts
import type { DAGLifecycleState } from '@noocodex/dagonizer/lifecycle';
```

Discriminated union of the six states a DAG lifecycle can occupy:

```ts
type DAGLifecycleState =
  | { kind: 'pending';   startedAt: null;   finishedAt: null;   error: null;  reason: null }
  | { kind: 'running';   startedAt: number; finishedAt: null;   error: null;  reason: null }
  | { kind: 'completed'; startedAt: number; finishedAt: number; error: null;  reason: null }
  | { kind: 'failed';    startedAt: number; finishedAt: number; error: Error; reason: null }
  | { kind: 'cancelled'; startedAt: number; finishedAt: number; error: null;  reason: string }
  | { kind: 'timed_out'; startedAt: number; finishedAt: number; error: null;  reason: null };
```

All timestamps are monotonic milliseconds from `Clock.monotonicMs()`. They are relative-time values suitable for duration math, not wall-clock display.

Inspect via `state.lifecycle.kind`. Narrow to a terminal variant to access its payload:

```ts
const lc = state.lifecycle;
if (lc.kind === 'failed') {
  console.error(lc.error); // Error
}
if (lc.kind === 'cancelled') {
  console.log(lc.reason); // string
}
if (lc.kind === 'completed') {
  const durationMs = lc.finishedAt - lc.startedAt;
}
```

---

## Type: `DAGLifecycleEvent`

Events consumed by `DAGLifecycleMachine.transition()`.

```ts
type DAGLifecycleEvent =
  | { type: 'start';   at?: number }
  | { type: 'succeed'; at?: number }
  | { type: 'fail';    error: Error; at?: number }
  | { type: 'cancel';  reason?: string; at?: number }
  | { type: 'timeout'; at?: number };
```

The optional `at` field overrides `Clock.monotonicMs()` for deterministic tests. In production, omit it; the machine reads the clock automatically.

---

## Class: `DAGLifecycleMachine`

Pure reducer for `DAGLifecycleState`. Static class; never instantiated.

```ts
import { DAGLifecycleMachine } from '@noocodex/dagonizer/lifecycle';
```

### `DAGLifecycleMachine.initial()`

```ts
static initial(): DAGLifecycleState
// Returns: { kind: 'pending', startedAt: null, finishedAt: null, error: null, reason: null }
```

Seed value for a new state object.

### `DAGLifecycleMachine.transition(state, event)`

```ts
static transition(
  state: DAGLifecycleState,
  event: DAGLifecycleEvent,
): DAGLifecycleState
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

```ts
static isTerminal(state: DAGLifecycleState): boolean
```

`true` if the state is one of `completed`, `failed`, `cancelled`, or `timed_out`.

```ts
if (DAGLifecycleMachine.isTerminal(state.lifecycle)) {
  // flow has ended
}
```

---

## Usage in custom state

Callers implementing `NodeStateInterface` without extending `NodeStateBase` use `DAGLifecycleMachine` directly:

```ts
import { DAGLifecycleMachine } from '@noocodex/dagonizer/lifecycle';
import type { DAGLifecycleState } from '@noocodex/dagonizer/lifecycle';
import type { NodeStateInterface } from '@noocodex/dagonizer';

class CustomState implements NodeStateInterface {
  private _lifecycle: DAGLifecycleState = DAGLifecycleMachine.initial();

  get lifecycle() { return this._lifecycle; }

  markRunning() {
    const next = DAGLifecycleMachine.transition(this._lifecycle, { type: 'start' });
    if (next === this._lifecycle) throw new Error('Cannot mark running');
    this._lifecycle = next;
  }
  // ... other mark methods ...
}
```
## Related guides

- [Cancellation](../guide/cancellation)
- [Observability](../guide/observability)
- [Subclassing State](../guide/subclassing)
