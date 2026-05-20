---
seeAlso:

  - text: 'Cancellation'

    link: './cancellation'
    description: '`onError` fires on abort and deadline-driven failures'

  - text: 'Subclassing State'

    link: './subclassing'
    description: 'your custom dispatcher subclass may also subclass state'

  - text: 'Services'

    link: './services'
    description: 'pass loggers / tracers in via the services bag'
---

# Observability

`Dagonizer` exposes five protected lifecycle hooks. Subclass the dispatcher and override any or all of them to attach metrics, structured logging, or distributed tracing.

## The five hooks

```ts
import { Dagonizer } from '@noocodex/dagonizer';
import type { ExecutionResultInterface } from '@noocodex/dagonizer';

class ObservableDispatcher<TState> extends Dagonizer<TState> {
  protected override onFlowStart(dagName: string, state: TState): void {
    console.log(`[flow:start] ${dagName}`);
  }

  protected override onFlowEnd(
    dagName: string,
    state: TState,
    result: ExecutionResultInterface<TState>,
  ): void {
    const lc = (state as any).lifecycle;
    console.log(`[flow:end] ${dagName} kind=${lc?.kind} cursor=${result.cursor}`);
  }

  protected override onNodeStart(nodeName: string, state: TState): void {
    console.log(`[node:start] ${nodeName}`);
  }

  protected override onNodeEnd(
    nodeName: string,
    output: string | undefined,
    state: TState,
  ): void {
    console.log(`[node:end] ${nodeName} output=${output}`);
  }

  protected override onError(nodeName: string, error: Error, state: TState): void {
    console.error(`[error] ${nodeName}: ${error.message}`);
  }
}
```

All five default to no-ops. Override only what you need — the base class provides no behavior.

Class extension is the only extension mechanism. There is no callback API. Multi-observer composition (logger + tracer + metrics) is a subclass concern — write it into your subclass.

## Hook contracts

| Hook | When called | Arguments |
|------|-------------|-----------|
| `onFlowStart` | After `state.markRunning()`, before the first node | `dagName`, `state` |
| `onFlowEnd` | After the last node (including aborted/failed paths) | `dagName`, `state`, `result` |
| `onNodeStart` | Before `node.execute()` for each node entry | `nodeName`, `state` |
| `onNodeEnd` | After each node resolves, before `yield` | `nodeName`, `output \| undefined`, `state` |
| `onError` | When a signal fires or a node throws | `nodeName`, `error`, `state` |

`onFlowEnd` is always called — even when the flow fails or is cancelled. `onError` may fire before `onFlowEnd` in the same execution.

For parallel and fan-out nodes, `onNodeStart` / `onNodeEnd` fire once for the group entry (the containing `parallel` or `fan-out` node), not once per constituent node.

## Structured logging example

```ts
import { Dagonizer, NodeStateBase } from '@noocodex/dagonizer';
import type { ExecutionResultInterface } from '@noocodex/dagonizer';

interface Span {
  name: string;
  start: number;
  end?: number;
  output?: string;
}

class TracingDispatcher<TState extends NodeStateBase> extends Dagonizer<TState> {
  readonly spans: Span[] = [];

  protected override onNodeStart(nodeName: string): void {
    this.spans.push({ name: nodeName, start: Date.now() });
  }

  protected override onNodeEnd(nodeName: string, output: string | undefined): void {
    const span = this.spans.find((s) => s.name === nodeName && s.end === undefined);
    if (span) {
      span.end = Date.now();
      span.output = output;
    }
  }
}

const dispatcher = new TracingDispatcher<MyState>();
// ...register and execute...
console.table(dispatcher.spans);
```

## OpenTelemetry sketch

```ts
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { Dagonizer } from '@noocodex/dagonizer';
import type { ExecutionResultInterface } from '@noocodex/dagonizer';

const tracer = trace.getTracer('dagonizer');

class OtelDispatcher<TState> extends Dagonizer<TState> {
  #spans = new Map<string, ReturnType<typeof tracer.startSpan>>();

  protected override onFlowStart(dagName: string): void {
    const span = tracer.startSpan(`flow.${dagName}`);
    this.#spans.set(dagName, span);
  }

  protected override onFlowEnd(dagName: string): void {
    this.#spans.get(dagName)?.end();
    this.#spans.delete(dagName);
  }

  protected override onNodeStart(nodeName: string): void {
    const span = tracer.startSpan(`node.${nodeName}`);
    this.#spans.set(nodeName, span);
  }

  protected override onNodeEnd(nodeName: string, output?: string): void {
    const span = this.#spans.get(nodeName);
    if (span) {
      span.setAttribute('output', output ?? '');
      span.end();
      this.#spans.delete(nodeName);
    }
  }

  protected override onError(nodeName: string, error: Error): void {
    const span = this.#spans.get(nodeName);
    if (span) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR });
    }
  }
}
```
## Related reference

- [Reference: Dagonizer](../reference/dagonizer)
- [Reference: Lifecycle](../reference/lifecycle)
