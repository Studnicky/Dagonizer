---
seeAlso:
  - text: 'Reference: Contracts — `NodeInterface`'
    link: './contracts'
  - text: 'Reference: Entities — `Node`, `NodeOutput`, `NodeContext`'
    link: './entities'
  - text: 'Reference: Core — `ParallelCombiner`, `FanInStrategy`'
    link: './core'
---

# Nodes

`@noocodex/dagonizer` / `@noocodex/dagonizer/types`

---

## Interface: `NodeInterface<TState, TOutput>`

The contract a node object must satisfy.

```ts
import type { NodeInterface } from '@noocodex/dagonizer';

const myNode: NodeInterface<MyState, 'success' | 'error'> = {
  name: 'my-node',
  outputs: ['success', 'error'],
  async execute(state, context) {
    // mutate state
    return { output: 'success' };
  },
};
```

| Member | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | `string` | yes | Registry key. Must be unique across all registered nodes. |
| `outputs` | `readonly TOutput[]` | yes | Declared output ports. Every value must appear in the node placement's `outputs` routing map. |
| `timeoutMs` | `number` | no | Per-node wall-clock budget in milliseconds. When set, the engine derives a child signal and fires `NodeTimeoutError` on expiry. |
| `execute` | `(state, context) => Promise<NodeOutputInterface<TOutput>>` | yes | The work. Mutates state in-place; returns the output name to route on. |
| `validate` | `() => ValidationResult` | no | Called once during `registerNode`. Return `{ valid: false, errors }` to reject. |
| `destroy` | `() => Promise<void>` | no | Called by `dispatcher.destroy()`. Use for resource cleanup. |

Nodes are stateless. All durable state lives in `TState`. Configuration is injected via the constructor.

---

## Interface: `NodeOutputInterface<TOutput>`

Returned by `execute()`.

```ts
interface NodeOutputInterface<TOutput extends string> {
  output: TOutput;
  errors?: NodeErrorInterface[];
}
```

| Field | Description |
|-------|-------------|
| `output` | The output name. Must match one of `outputs`. |
| `errors` | Optional error objects to collect into `state.errors`. Not thrown. |

---

## Interface: `NodeContextInterface<TServices>`

The second argument to `execute()`.

```ts
interface NodeContextInterface<TServices = undefined> {
  readonly signal: AbortSignal;
  readonly dagName: string;
  readonly nodeName: string;
  readonly services: TServices;
}
```

Always propagate `context.signal` to every IO call (fetch, database, sleep in RetryPolicy). `services` carries the typed services bag the dispatcher was constructed with; `undefined` when no services were supplied.

---

## Interface: `ValidationResult`

Returned by the optional `validate()` method.

```ts
type ValidationResult =
  | { valid: true }
  | { valid: false; errors: string[] }
```

---

## Class: `NodeStateBase`

The base class for all domain-specific state objects.

```ts
import { NodeStateBase } from '@noocodex/dagonizer';
```

**Constructor**: `new NodeStateBase()` — no arguments.

**Domain fields**: add your own by subclassing.

**Inherited members:**

| Member | Description |
|--------|-------------|
| `lifecycle` | `DAGLifecycleState` discriminated union. Read-only getter. |
| `errors` | `readonly NodeErrorInterface[]` — accumulated errors from all nodes. |
| `warnings` | `readonly NodeWarning[]` — accumulated warnings. |
| `metadata` | `Readonly<Record<string, unknown>>` — key-value bag. |
| `getMetadata<T>(key)` | Typed metadata read. |
| `setMetadata(key, value)` | Write a metadata key. |
| `collectError(error)` | Append an error without stopping the DAG. |
| `collectWarning(warn)` | Append a warning. |
| `markRunning()` | Dispatcher-internal. Transitions `pending → running`. |
| `markCompleted()` | Dispatcher-internal. Transitions `running → completed`. |
| `markFailed(error)` | Dispatcher-internal. Transitions `running → failed`. |
| `markCancelled(reason)` | Dispatcher-internal. Transitions `running → cancelled`. |
| `markTimedOut()` | Dispatcher-internal. Transitions `running → timed_out`. |
| `snapshot()` | Returns a `JsonObject` for checkpointing. |
| `clone()` | Returns a new instance (metadata copied, lifecycle reset, errors/warnings empty). |
| `static restore(snap)` | Static factory. Returns a hydrated instance; calls `restoreData(snap)`. |

**Override hooks:**

```ts
protected snapshotData(): JsonObject    // add domain fields to snapshot
protected restoreData(snap: JsonObject): void  // restore domain fields
```

See [Subclassing State](/guide/subclassing) for examples.
## Related guides

- [Subclassing State](../guide/subclassing)
- [Services](../guide/services)
