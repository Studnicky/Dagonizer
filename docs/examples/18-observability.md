---
title: 'Example 18: Observability'
description: 'Two observability surfaces side-by-side: subclass hooks (onFlowStart, onFlowEnd, onNodeStart, onNodeEnd, onError) and the NoopInstrumentation plugin. Both coexist on the same dispatcher instance.'
seeAlso:
  - text: 'Observability guide'
    link: '../guide/observability'
    description: 'full hook reference, instrumentation plugin API, and metrics patterns'
  - text: 'Example 20: Streaming'
    link: './20-streaming'
    description: 'async-iterable execution API: per-node progress events'
  - text: 'Reference: Contracts, Instrumentation'
    link: '../reference/contracts'
---

# Example 18: Observability

Two ways to observe a `Dagonizer` run, shown side-by-side on the same two-node pipeline (`validate → transform`):

**(a) Subclass hooks.** Extend `Dagonizer` and override `onFlowStart`, `onFlowEnd`, `onNodeStart`, `onNodeEnd`, `onError`. The class owns the observer; no extra objects are required.

**(b) Instrumentation plugin.** Extend `NoopInstrumentation` and override only the hooks you need. Pass the instance via the `instrumentation:` constructor option. The dispatcher fires both the subclass hooks and the instrumentation hooks at every boundary — the two surfaces coexist.

## Code

<<< @/../examples/18-observability.ts

## What it demonstrates

- **Subclass hook surface.** Override the protected lifecycle methods on `Dagonizer`. The five hooks receive the same arguments regardless of which execution path fired them: `onFlowStart(dagName, state)`, `onFlowEnd(dagName, state, result)`, `onNodeStart(dagName, nodeName, state)`, `onNodeEnd(dagName, nodeName, state, result)`, `onError(dagName, nodeName, state, error)`.
- **`NoopInstrumentation` plugin.** Import from `@noocodex/dagonizer`. Extend it and override only the hooks relevant to your observer. The base class provides empty implementations for all hooks, so you only write what you need.
- **`instrumentation` option.** Pass a `NoopInstrumentation` subclass instance as `instrumentation:` in the `Dagonizer` constructor. The dispatcher calls both the subclass hooks and the instrumentation hooks at each boundary — they are additive, not exclusive.
- **Coexistence.** Both surfaces receive every event. The subclass hook runs first; the instrumentation hook runs after. Use the subclass for the primary observer that owns the dispatcher; use `instrumentation` for a secondary observer (metrics, tracing, logging middleware) injected from outside.

## Run

```bash
npx tsx examples/18-observability.ts
```
