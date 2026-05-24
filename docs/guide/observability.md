---
title: 'Observability'
description: 'Subclass Dagonizer for protected on* hooks; install Instrumentation for composable plugin observers.'
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

Two surfaces fire at every execution boundary: the protected `on*` hooks on `Dagonizer` (subclass to observe) and the `Instrumentation` contract (instance passed to the constructor). The dispatcher invokes both, so plugin-supplied tracing and subclass-local metrics coexist without a hand-rolled multiplexer.

## API surface

| Symbol | Source | Role |
|--------|--------|------|
| `Dagonizer.on*` | `@noocodex/dagonizer` | Protected hooks: `onFlowStart`, `onFlowEnd`, `onNodeStart`, `onNodeEnd`, `onError` |
| `Instrumentation<TState>` | `@noocodex/dagonizer/contracts` | Vendor-neutral hook surface |
| `NoopInstrumentation<TState>` | `@noocodex/dagonizer` | No-op base for selective override |
| `DagonizerOptionsInterface.instrumentation` | `@noocodex/dagonizer` | Constructor slot for the contract |

## The five subclass hooks

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
    console.log(`[flow:end] ${dagName} cursor=${result.cursor}`);
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

All five default to no-ops. Override only the hooks you need. Class extension is the only extension mechanism; the dispatcher exposes no callback API. Multi-observer composition (logger plus tracer plus metrics) is a subclass concern: write it into the subclass body.

## Hook contracts

| Hook | When called | Arguments |
|------|-------------|-----------|
| `onFlowStart` | After `state.markRunning()`, before the first node | `dagName`, `state` |
| `onFlowEnd` | After the last node (including aborted or failed paths) | `dagName`, `state`, `result` |
| `onNodeStart` | Before `node.execute()` for each node entry | `nodeName`, `state` |
| `onNodeEnd` | After each node resolves, before `yield` | `nodeName`, `output \| undefined`, `state` |
| `onError` | When a signal fires or a node throws | `nodeName`, `error`, `state` |

`onFlowEnd` is always called, even when the flow fails or is cancelled. `onError` may fire before `onFlowEnd` in the same execution.

For parallel and fan-out nodes, `onNodeStart` and `onNodeEnd` fire once for the group entry (the containing `parallel` or `fan-out` node), not once per constituent node.

## Structured logging

```ts
import { Dagonizer, NodeStateBase } from '@noocodex/dagonizer';

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
```

## OpenTelemetry sketch

```ts
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { Dagonizer } from '@noocodex/dagonizer';

const tracer = trace.getTracer('dagonizer');

class OtelDispatcher<TState> extends Dagonizer<TState> {
  #spans = new Map<string, ReturnType<typeof tracer.startSpan>>();

  protected override onFlowStart(dagName: string): void {
    this.#spans.set(dagName, tracer.startSpan(`flow.${dagName}`));
  }

  protected override onFlowEnd(dagName: string): void {
    this.#spans.get(dagName)?.end();
    this.#spans.delete(dagName);
  }

  protected override onNodeStart(nodeName: string): void {
    this.#spans.set(nodeName, tracer.startSpan(`node.${nodeName}`));
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

## Composable observers: the `Instrumentation` contract

The subclass-hook pattern fits when one consumer owns the dispatcher. It does not compose: dropping in vendor-supplied tracing alongside in-house metrics requires a hand-rolled multiplexer.

For multi-observer scenarios, install an `Instrumentation` implementation via `DagonizerOptionsInterface.instrumentation`. The dispatcher fires both surfaces at every execution boundary, so a single dispatcher mixes subclass-local observability with plugin-supplied tracing, metrics, or audit collectors.

```ts
import { Dagonizer, NoopInstrumentation } from '@noocodex/dagonizer';
import type { NodeStateInterface } from '@noocodex/dagonizer';

class CountingInstrumentation<TState extends NodeStateInterface>
extends NoopInstrumentation<TState> {
  nodeStarts = 0;
  nodeEnds   = 0;

  override nodeStart(_dagName: string, _nodeName: string, _state: TState): void {
    this.nodeStarts++;
  }

  override nodeEnd(_dagName: string, _nodeName: string, _output: string | undefined, _state: TState): void {
    this.nodeEnds++;
  }
}

const counter = new CountingInstrumentation();
const dispatcher = new Dagonizer({ instrumentation: counter });
```

### Hook surface

| Hook | When called | Arguments |
|------|-------------|-----------|
| `flowStart` | Before the entrypoint node runs | `dagName`, `state` |
| `flowEnd` | After the loop drains (terminal or interrupted) | `dagName`, `state`, `result` |
| `nodeStart` | Before each node's `execute()` | `dagName`, `nodeName`, `state` |
| `nodeEnd` | After the node's result is recorded | `dagName`, `nodeName`, `output \| undefined`, `state` |
| `phaseEnter` | Before a pre/post phase placement runs | `dagName`, `phase`, `placementName`, `state` |
| `phaseExit` | After a pre/post phase placement runs | `dagName`, `phase`, `placementName`, `state` |
| `contractWarning` | Non-fatal dangling-write warning at `registerDAG` | `message` |
| `error` | Any thrown error the dispatcher catches | `dagName`, `nodeName`, `error`, `state` |

The `phaseEnter` and `phaseExit` hooks are declared on the contract (see `packages/dagonizer/src/contracts/Instrumentation.ts`). They fire from the lifecycle-phases path described in [Lifecycle phases](../guide/lifecycle-phases).

### Hooks must not throw

The dispatcher does not wrap instrumentation calls in `try/catch`. A hook that throws aborts the surrounding flow. Wrap any I/O (HTTP exporters, file writes) inside the implementation so external failures stay external.

### When to use which surface

| Use case | Surface |
|----------|---------|
| One consumer, simple metrics or logging | Subclass `Dagonizer` and override `on*` hooks |
| Plugin-supplied tracing (`@noocodex/dagonizer-tracing-otel`) | `Instrumentation` |
| Multiple observers (tracing plus metrics plus audit) | One `Instrumentation` per concern, composed in a multiplexer that itself implements `Instrumentation` |
| Vendor-neutral observability surface for third-party packages | `Instrumentation` |

Both surfaces remain available even when only one is in use; the dispatcher fires the subclass `on*` hooks and the `instrumentation.*` methods at the same boundaries.

## Related reference

- [Reference: Dagonizer](../reference/dagonizer)
- [Reference: Contracts](../reference/contracts)
- [Reference: Lifecycle](../reference/lifecycle)
