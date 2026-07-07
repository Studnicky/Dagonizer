---
title: 'Execution Tuning'
description: 'How to tune Dagonizer execution with substrate concurrency, throttling, retry, deadlines, coalescing, timing, and resilience primitives.'
---

# Execution Tuning

## What It Is

Execution tuning is the set of controls you reach for after the graph shape is right. The DAG still says what should happen; tuning controls how aggressively it happens: concurrency, throttling, retries, deadlines, coalescing, timing, and provider resilience.

The important rule is to tune at execution boundaries instead of adding fake nodes. Scatter fan-out, batch item execution, adapters, HTTP tools, stream channels, progress delivery, and observer sinks all expose focused knobs for the work they own.

## How It Works

Tuning lives at execution boundaries: scatter policies, batch execution options, adapter calls, tool transports, stream channels, and observer delivery. Each surface accepts focused primitives such as semaphores, throttles, token buckets, retry policies, and composed abort signals.

Dagonizer exposes tuning at the execution boundaries where it changes behavior:
scatter fan-out, batch item execution, LLM adapters, tool HTTP transport, stream channels, progress delivery, and observability. These surfaces use substrate primitives directly, so applications tune the same concepts everywhere instead of wrapping nodes in raw `Promise.all`.

## Diagrams, Examples, and Outputs

Execution tuning is mostly runtime policy, so this page uses a decision table and focused snippets instead of a new diagram. Use the runnable examples to see each tuning surface in context:

- [The Archivist](../examples/the-archivist) - browser runnable for agent memory, tools, and retries
- [The Cartographer](../examples/the-cartographer) - browser runnable for streaming, scatter/gather, and plugin-style DAG parts
- [The Dispatcher](../examples/the-dispatcher) - browser runnable for routing, handoff, and operational control
- [Example 12: Worker Containers](../examples/12-workers) - container-backed scatter execution
- [Example 20: Streaming Execution](../examples/20-streaming) - progress from the execution stream
- [Example 22: Retry Timing and Salvage](../examples/22-backoff-strategies) - retry timing separate from retry topology

## What It Lets You Do

### Use when

Use execution tuning when the graph shape is correct but the host needs stronger control over concurrency, rate limits, retries, coalescing, or deadlines. These knobs tune execution behavior without adding fake nodes to the DAG.

## Code Samples

The snippets below show where tuning lives: scatter execution policy, adapter resilience, timing sinks, coalescing, stream backpressure, and progress delivery.

## Details for Nerds

### Decision table

| Need | Use | Where |
|---|---|---|
| Hard cap on simultaneous work | `Semaphore` | `ScatterNode.execution.concurrency`, `BatchExecutionOptionsType.concurrency` |
| Adaptive or secondary pacing | `Throttle` | `ScatterNode.execution.throttle`, `BatchExecutionOptionsType.throttle` |
| Provider throughput budget | `TokenBucket` | `BaseAdapterOptionsType.tokenBucket`, `HttpRequestOptionsType.tokenBucket` |
| Fast-fail unhealthy provider | `CircuitBreaker` | `BaseAdapterOptionsType.circuitBreaker`, `HttpRequestOptionsType.circuitBreaker` |
| Retry one transient operation | `RetryPolicy` / substrate `Retry` | Adapter calls, tool HTTP transport, caller-owned operation wrappers |
| Deadline and cancellation | `Signal.compose` | `Dagonizer.execute`, adapters, tool transport, node context signals |
| Duplicate in-flight request collapse | `Coalesce` | Embedding calls and live lookup services |
| Operation timing context | `Timing` / `TimingEvent` | `ObservedDagOptionsType.timing`, `BaseAdapterOptionsType.timing`, `BatchExecutionOptionsType.timing` |
| Backpressure-isolated fan-out events | substrate `EventBus`/`BusQueue` | `@studnicky/dagonizer/progress` |

### Scatter policy

Use scatter `concurrency` as the first control. It is a hard pull-ahead cap: the dispatcher only pulls another source item when a worker slot is available.

```json
{
  "execution": {
    "mode": "item",
    "concurrency": 8
  }
}
```

Add `throttle` only when dispatch needs a second pacing layer. This is useful when CPU, browser model runtime, or provider latency should influence how many calls are active even though the scatter source can be pulled faster.

```json
{
  "execution": {
    "mode": "item",
    "concurrency": 16,
    "throttle": {
      "concurrencyLimit": 4,
      "adaptive": {
        "enabled": true,
        "targetLatencyMs": 250,
        "minConcurrency": 2,
        "maxConcurrency": 12,
        "sampleWindow": 20,
        "adjustmentInterval": 1000,
        "scaleUpThreshold": 0.75,
        "scaleDownThreshold": 1.25,
        "stepSize": 1
      }
    }
  }
}
```

Reservoir mode batches by key and uses `concurrency` at batch granularity. It has no per-item throttle field because a variable-size batch is not a discrete item dispatch.

### Adapter and tool resilience

Adapters and HTTP tools accept substrate resilience instances directly. Construct them in application code and pass them to the boundary that owns the provider call.

```ts
import { CircuitBreaker, TokenBucket } from '@studnicky/resilience';

const circuitBreaker = CircuitBreaker.create({
  failureThreshold: 5,
  resetTimeoutMs: 10_000,
  successThreshold: 2,
  name: 'primary-llm',
});

const tokenBucket = TokenBucket.create({
  requestsPerSecond: 5,
  burstSize: 10,
});
```

For adapters, the circuit breaker wraps the whole logical call, the token bucket gates before the retry loop, and the adapter retry policy handles retryable provider errors inside that boundary. For tools, `HttpTransport` applies the same order around HTTP retries. A retry never burns extra rate-limit tokens for the same logical request.

### Timing

Use substrate `Timing` when a run needs operation-level timing context. Pass an application-owned timing sink into the boundaries that perform work:

```ts
import { Timing } from '@studnicky/timing';
import { ObservedDag } from '@studnicky/dagonizer';

const timing = Timing.create({ maxEvents: 100 });
const dispatcher = new ObservedDag(logger, { timing });
```

`ObservedDag` records `dag.flow.*`, `dag.node.*`, and `dag.phase.*` events. `BaseAdapter` records `adapter.chat.*` and `adapter.chatStream.*` events when `BaseAdapterOptionsType.timing` is supplied. `BatchItemExecutor` records `batch.item.*` events when `BatchExecutionOptionsType.timing` is supplied through pattern nodes, tool invocation, or direct calls. Keep one `Timing` instance per request, run, or trace window; call `timing.getEvents()` when emitting the final structured log record.

### Coalescing

Coalescing is for duplicate in-flight misses, not long-lived cache entries. `BaseEmbedder.embed()` coalesces identical text for the same embedder, model, dimensions, and caller signal. Cartographer live address and IP resolvers coalesce duplicate external lookups for the same key and signal, then populate their normal cache when the request settles.

Signal identity is part of the key. Calls with different `AbortSignal` instances do not share the same in-flight provider request, so one caller's abort policy does not cancel unrelated callers.

### Streams and progress

`StreamChannel` remains Dagonizer-owned because it provides awaited bounded `push()`, explicit failure propagation, and durable resume cursors. Substrate `Channel` and `AsyncIter` are useful for generic async composition, but they do not replace the stream resume contract.

Progress uses substrate `EventBus` through `@studnicky/dagonizer/progress`. Each subscriber receives its own `BusQueue`; a slow subscriber applies backpressure to its own queue without blocking unrelated subscribers.

### Practical defaults

Start with `execution.concurrency` only. Add `throttle` when active work needs adaptive pacing. Add `TokenBucket` for external quotas, `CircuitBreaker` for dependency health, `Timing` for request/run context, and `RetryPolicy` for one operation that can succeed by trying again. Use flow-level retry edges when the graph needs to route to recovery work.

## Related Concepts

- [Architecture](../architecture) - system-level model for JSON-LD DAG orchestration
- [The Archivist](../examples/the-archivist) - browser demo for memory, tools, and retries
- [The Cartographer](../examples/the-cartographer) - streaming data-pipeline demo for scatter, gather, and plugins
- [Example 12: Worker Containers](../examples/12-workers) shows container-backed scatter execution.
- [Example 20: Streaming Execution](../examples/20-streaming) shows progress from the execution stream.
- [Example 22: Retry Timing and Salvage](../examples/22-backoff-strategies) shows retry timing separate from retry topology.
