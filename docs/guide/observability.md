---
title: 'Observability'
description: 'Subclass Dagonizer and override protected on* hooks to observe every execution boundary.'
seeAlso:
  - text: 'Cancellation'
    link: './cancellation'
    description: '`onError` fires on abort and deadline-driven failures'
  - text: 'Subclassing State'
    link: './subclassing'
    description: 'a dispatcher subclass may also subclass state'
  - text: 'Dependency injection'
    link: './services'
    description: 'pass loggers or tracers via constructor injection'
---

# Observability

Protected `on*` hooks on `Dagonizer` fire at every execution boundary. Subclass the dispatcher and override whichever hooks you need. Class extension is the only extension mechanism; the dispatcher exposes no callback API.

## API surface

| Symbol | Source | Role |
|--------|--------|------|
| `Dagonizer.onFlowStart` | `@studnicky/dagonizer` | Fires after `state.markRunning()`, before the first node |
| `Dagonizer.onFlowEnd` | `@studnicky/dagonizer` | Fires after the last node (including aborted or failed paths) |
| `Dagonizer.onNodeStart` | `@studnicky/dagonizer` | Fires before each `node.execute()` |
| `Dagonizer.onNodeEnd` | `@studnicky/dagonizer` | Fires after each node resolves, before `yield` |
| `Dagonizer.onError` | `@studnicky/dagonizer` | Fires when a signal fires or a node throws |
| `Dagonizer.onPhaseEnter` | `@studnicky/dagonizer` | Fires before a `pre`/`post` phase placement runs |
| `Dagonizer.onPhaseExit` | `@studnicky/dagonizer` | Fires after a `pre`/`post` phase placement completes |

## Subclass hooks

<<< @/../examples/the-archivist/ObservedDag.ts#observed-dag

All seven default to no-ops. Override only the hooks you need. Multi-observer composition (logger plus tracer plus metrics) is a subclass concern: write it into the subclass body.

## Hook contracts

| Hook | When called | Arguments |
|------|-------------|-----------|
| `onFlowStart` | After `state.markRunning()`, before the first node | `dagName`, `state` |
| `onFlowEnd` | After the last node (including aborted or failed paths) | `dagName`, `state`, `result` |
| `onNodeStart` | Before `node.execute()` for each node entry | `nodeName`, `state`, `placementPath` |
| `onNodeEnd` | After each node resolves, before `yield` | `nodeName`, `output: string \| null`, `state`, `placementPath` |
| `onError` | When a signal fires or a node throws | `nodeName`, `error`, `state`, `placementPath` |
| `onPhaseEnter` | Before a `pre`/`post` phase placement runs | `dagName`, `phase`, `placementName`, `state`, `placementPath` |
| `onPhaseExit` | After a `pre`/`post` phase placement completes | `dagName`, `phase`, `placementName`, `state`, `placementPath` |

`onFlowEnd` is always called, even when the flow fails or is cancelled. `onError` may fire before `onFlowEnd` in the same execution.

For scatter and embedded-DAG nodes, `onNodeStart` and `onNodeEnd` fire once for the group entry (the containing `scatter` or `embedded-dag` placement), not once per constituent clone or inner node.

### `placementPath`

`placementPath` is a required `readonly string[]` argument on `onNodeStart`, `onNodeEnd`, and `onError`. It is the ordered list of parent embedded-DAG placement names that led to the current node:

- Top-level node: `[]`
- Node inside an `EmbeddedDAGNode` placement named `on-topic-search`: `['on-topic-search']`
- Doubly-nested: `['on-topic-search', 'inner-placement']`

Use it to disambiguate same-named inner placements across multiple embedded-DAG instances. The full qualified id of the current node is `[...placementPath, nodeName].join('/')`.

## Subclass observer

<<< @/../examples/18-observability.ts#subclass-observer

## OpenTelemetry integration

OpenTelemetry spans map directly onto the `onFlowStart` / `onFlowEnd` and `onNodeStart` / `onNodeEnd` pairs. The pattern is identical to the subclass observer above:

- `onFlowStart` → `tracer.startSpan('flow.<dagName>')`, stash in a `Map`.
- `onNodeStart` → `tracer.startSpan('node.<nodeName>')`, stash keyed by node name.
- `onNodeEnd` → retrieve the span, call `span.setAttribute('output', ...)`, then `span.end()`.
- `onError` → retrieve the span, call `span.recordException(error)` and `span.setStatus({ code: SpanStatusCode.ERROR })`.
- `onFlowEnd` → end the flow span and clear the map.

Wire `@opentelemetry/api` in through the constructor as a `Tracer` instance. The subclass holds the `Map<string, Span>` as a private field; nothing leaks to Dagonizer's public surface.

## Multi-observer composition

When one consumer owns the dispatcher, the subclass pattern is sufficient. For multiple observers (logger plus tracer plus metrics), accept each as a constructor parameter and dispatch to all inside the relevant hook overrides:

<<< @/../examples/18-observability.ts#multi-observer

## Related reference

- [Reference: Dagonizer](../reference/dagonizer)
- [Reference: Contracts](../reference/contracts)
- [Reference: Lifecycle](../reference/lifecycle)
