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
  - text: 'Services'
    link: './services'
    description: 'pass loggers or tracers in via the services bag'
---

# Observability

Protected `on*` hooks on `Dagonizer` fire at every execution boundary. Subclass the dispatcher and override whichever hooks you need. Class extension is the only extension mechanism; the dispatcher exposes no callback API.

## API surface

| Symbol | Source | Role |
|--------|--------|------|
| `Dagonizer.onFlowStart` | `@noocodex/dagonizer` | Fires after `state.markRunning()`, before the first node |
| `Dagonizer.onFlowEnd` | `@noocodex/dagonizer` | Fires after the last node (including aborted or failed paths) |
| `Dagonizer.onNodeStart` | `@noocodex/dagonizer` | Fires before each `node.execute()` |
| `Dagonizer.onNodeEnd` | `@noocodex/dagonizer` | Fires after each node resolves, before `yield` |
| `Dagonizer.onError` | `@noocodex/dagonizer` | Fires when a signal fires or a node throws |
| `Dagonizer.onPhaseEnter` | `@noocodex/dagonizer` | Fires before a `pre`/`post` phase placement runs |
| `Dagonizer.onPhaseExit` | `@noocodex/dagonizer` | Fires after a `pre`/`post` phase placement completes |
| `Dagonizer.onContractWarning` | `@noocodex/dagonizer` | Fires for non-fatal contract-registry warnings at `registerDAG` |

## Subclass hooks

<<< @/../examples/the-archivist/ObservedArchivist.ts#observed-archivist

All eight default to no-ops. Override only the hooks you need. Multi-observer composition (logger plus tracer plus metrics) is a subclass concern: write it into the subclass body.

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
| `onContractWarning` | When `registerDAG` produces a non-fatal warning | `message: string` |

`onFlowEnd` is always called, even when the flow fails or is cancelled. `onError` may fire before `onFlowEnd` in the same execution.

For scatter and embedded-DAG nodes, `onNodeStart` and `onNodeEnd` fire once for the group entry (the containing `scatter` or `embedded-dag` placement), not once per constituent clone or inner node.

### `placementPath`

`placementPath` is a required `readonly string[]` argument on `onNodeStart`, `onNodeEnd`, and `onError`. It is the ordered list of parent embedded-DAG placement names that led to the current node:

- Top-level node: `[]`
- Node inside an `EmbeddedDAGNode` placement named `on-topic-search`: `['on-topic-search']`
- Doubly-nested: `['on-topic-search', 'inner-placement']`

Use it to disambiguate same-named inner placements across multiple embedded-DAG instances. The full qualified id of the current node is `[...placementPath, nodeName].join('/')`.

## Structured logging

```ts twoslash
import { Dagonizer, NodeStateBase } from '@noocodex/dagonizer';

interface Span {
  name: string;
  start: number;
  end?: number;
  output?: string;
}

class TracingDispatcher<TState extends NodeStateBase> extends Dagonizer<TState> {
  readonly spans: Span[] = [];

  protected override onNodeStart(nodeName: string, state: TState, placementPath: readonly string[]): void {
    this.spans.push({ name: nodeName, start: Date.now() });
  }

  protected override onNodeEnd(nodeName: string, output: string | null, state: TState, placementPath: readonly string[]): void {
    const span = this.spans.find((s) => s.name === nodeName && s.end === undefined);
    if (span) {
      span.end = Date.now();
      if (output !== null) span.output = output;
    }
  }
}
```

## OpenTelemetry sketch

```ts twoslash
import { Dagonizer, NodeStateBase } from '@noocodex/dagonizer';

// Minimal OTel surface — replace with @opentelemetry/api in production.
interface OtelSpan {
  end(): void;
  setAttribute(key: string, value: string): void;
  recordException(error: Error): void;
  setStatus(status: { code: number }): void;
}
interface OtelTracer { startSpan(name: string): OtelSpan; }
declare const trace: { getTracer(name: string): OtelTracer };
declare const SpanStatusCode: { readonly ERROR: number };
// ---cut---
const tracer = trace.getTracer('dagonizer');

class OtelDispatcher<TState extends NodeStateBase> extends Dagonizer<TState> {
  #spans = new Map<string, OtelSpan>();

  protected override onFlowStart(dagName: string): void {
    this.#spans.set(dagName, tracer.startSpan(`flow.${dagName}`));
  }

  protected override onFlowEnd(dagName: string): void {
    this.#spans.get(dagName)?.end();
    this.#spans.delete(dagName);
  }

  protected override onNodeStart(nodeName: string, state: TState, placementPath: readonly string[]): void {
    this.#spans.set(nodeName, tracer.startSpan(`node.${nodeName}`));
  }

  protected override onNodeEnd(nodeName: string, output: string | null, state: TState, placementPath: readonly string[]): void {
    const span = this.#spans.get(nodeName);
    if (span) {
      span.setAttribute('output', output ?? '');
      span.end();
      this.#spans.delete(nodeName);
    }
  }

  protected override onError(nodeName: string, error: Error, state: TState, placementPath: readonly string[]): void {
    const span = this.#spans.get(nodeName);
    if (span) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR });
    }
  }
}
```

## Multi-observer composition

When one consumer owns the dispatcher, the subclass pattern is sufficient. For multiple observers (logger plus tracer plus metrics), compose them inside the subclass:

```ts twoslash
// ---cut---
import { Dagonizer, NodeStateBase } from '@noocodex/dagonizer';
import type { DagonizerOptionsInterface } from '@noocodex/dagonizer';

declare class Logger {
  info(msg: string): void;
}
declare class Tracer {
  startSpan(name: string): void;
  endSpan(name: string): void;
}
// ---cut---
class ComposedDispatcher<TState extends NodeStateBase> extends Dagonizer<TState> {
  readonly #logger: Logger;
  readonly #tracer: Tracer;

  constructor(options: DagonizerOptionsInterface<TState>, logger: Logger, tracer: Tracer) {
    super(options);
    this.#logger = logger;
    this.#tracer = tracer;
  }

  protected override onNodeStart(nodeName: string, state: TState, placementPath: readonly string[]): void {
    this.#logger.info(`node.start nodeName=${nodeName}`);
    this.#tracer.startSpan(`node.${nodeName}`);
  }

  protected override onNodeEnd(nodeName: string, output: string | null, state: TState, placementPath: readonly string[]): void {
    this.#logger.info(`node.end nodeName=${nodeName} output=${output ?? '(terminal)'}`);
    this.#tracer.endSpan(`node.${nodeName}`);
  }
}
```

## Related reference

- [Reference: Dagonizer](../reference/dagonizer)
- [Reference: Contracts](../reference/contracts)
- [Reference: Lifecycle](../reference/lifecycle)
