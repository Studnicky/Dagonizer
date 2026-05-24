---
title: 'Phase 07: Retry'
description: 'Two retry surfaces in The Archivist: per-call retry on every scout and on LLM ranking (RetryPolicy.run inside the node), and a DAG-level bounded retry loop in ComposeRetryLoopDAG.'
seeAlso:
  - text: 'Running domain: The Archivist'
    link: './the-archivist'
  - text: 'Retry guide'
    link: '../guide/retry'
  - text: 'Phase 06: Cancellation'
    link: './06-cancellation'
  - text: 'Reference: Runtime, `RetryPolicy`, `BackoffStrategy`'
    link: '../reference/runtime'
  - text: 'Reference: Contracts, `RetryPolicyOptionsInterface`'
    link: '../reference/contracts'
---

<script setup lang="ts">
import { CytoscapeRenderer } from '@noocodex/dagonizer/viz';
import type { ElementDefinition } from 'cytoscape';
import { ComposeRetryLoopDAG } from '@archivist/embedded-dags/ComposeRetryLoopDAG.ts';

const elements = CytoscapeRenderer.render(ComposeRetryLoopDAG) as ElementDefinition[];
</script>

# Phase 07: Retry

[The Archivist](./the-archivist) exercises two distinct retry shapes:

1. **Per-call retry.** Every scout and the LLM ranker wrap their external calls in `RetryPolicy.run`, so transient failures (network errors, malformed LLM JSON) are automatically retried with exponential backoff before the node reports its output.
2. **DAG-level retry loop.** `validateResponse` routes back to `compose-response` when the draft fails the quality check, bounded by `state.attempts.compose` so the loop terminates instead of spinning.

Neither shape throws. The dispatcher always sees a named output.

<DagGraph :elements="elements" aria-label="ComposeRetryLoopDAG: compose, validate, retry loop bounded by attempt counter." />

## Code

### Per-call retry: scouts

The `#scout-retry` region shows the `scoutRetry` policy used by all four scouts: exponential backoff, 2 max attempts, signal-aware:

<<< @/../examples/the-archivist/nodes/scouts.ts#scout-retry

### Per-call retry: LLM ranking

The `#rank-retry` region shows the `rankRetry` policy used by `rankCandidates`. Same shape, wrapping the LLM rank call so schema-violation responses get a second chance:

<<< @/../examples/the-archivist/nodes/rankCandidates.ts#rank-retry

### DAG-level retry loop

The complete `ComposeRetryLoopDAG`, a bounded compose, validate, retry loop built from plain `.node()` routes:

<<< @/../examples/the-archivist/embedded-dags/ComposeRetryLoopDAG.ts

## What it demonstrates

- **`RetryPolicy.run(task, signal)`.** Composable per-call retry with `EXPONENTIAL`, `LINEAR`, `CONSTANT`, or `DECORRELATED_JITTER` backoff. The second argument is `context.signal`; the policy aborts mid-backoff when the signal fires (see [Phase 06](./06-cancellation)).
- **Bounded loop modeled in the DAG itself.** `validateResponse` routes `'retry'` back to `'crl-compose-response'`. The bound is tracked on `state.attempts.compose` inside the node; no special loop placement type.
- **Best-effort fallback.** `'exhausted'` and `'approved'` both route to `crl-respond-to-visitor`. The visitor always gets a response; the dispatcher never throws on exhaustion.
- **Ranking is best-effort too.** If `rankRetry` exhausts without a valid score, the `catch` block routes `'ranked'` with zero-scored candidates so `mergeCandidates` can still soft-gate.

See this in action in the [Archivist live demo](./the-archivist).
