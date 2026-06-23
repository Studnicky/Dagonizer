---
"@studnicky/dagonizer": minor
---

Declarative per-placement retry: `SingleNodeType` gains an optional `retry` field
(`PlacementRetryConfigType` = `RetryPolicyOptionsType` + `on?: string[]`) that the engine
honours automatically. When a node throws, `NodeScheduler` applies the configured backoff
delay and re-fires the node up to `maxAttempts` times. The optional `on` field filters
which error messages trigger a retry; absent means retry on any throw.

`DAGBuilder.node()` accepts `options.retry` so declarative retry integrates with the
fluent builder. The existing `state.withinRetryBudget()` loop-edge pattern inside nodes
continues to work; placement-level retry is an opt-in complement.
