# Example: Cancellation

Demonstrates both cancellation shapes: caller-controlled `AbortController.signal` and a dispatcher-managed `deadlineMs` hard limit.

## Flow

```mermaid
flowchart TB
  start([entrypoint])
  slow[slow]
  fast[fast]
  END([end])
  start --> slow
  slow -->|done| fast
  fast -->|done| END
  slow -. signal.abort .-> cancelled([cancelled])
  slow -. deadlineMs hits .-> timedOut([timed_out])
```

## Code

```ts
/**
 * 04-cancellation — AbortSignal + deadlineMs.
 *
 * Demonstrates both shapes of cancellation:
 *   (a) caller-controlled abort via AbortController.signal
 *   (b) dispatcher deadline via deadlineMs
 *
 * Inspect `state.lifecycle.kind` after each run — 'cancelled' vs 'timed_out'.
 *
 * Run: npx tsx examples/04-cancellation.ts
 */

import {
  NodeStateBase,
  Dagonizer,
} from '../src/index.js';
import type { DAG, NodeInterface } from '../src/index.js';

const slow: NodeInterface<NodeStateBase, 'success'> = {
  "name": 'slow',
  "outputs": ['success'],
  async execute(_state, context) {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, 5_000);
      context.signal.addEventListener('abort', () => { clearTimeout(t); reject(context.signal.reason); }, { "once": true });
    });
    return { "output": 'success' };
  },
};

const dag: DAG = {
  "name": 'slow-dag',
  "version": '1',
  "entrypoint": 'slow',
  "nodes": [{ "type": 'single', "name": 'slow', "node": 'slow', "outputs": { "success": null } }],
};

const dispatcher = new Dagonizer<NodeStateBase>();
dispatcher.registerNode(slow);
dispatcher.registerDAG(dag);

// (a) User cancellation
const ctl = new AbortController();
setTimeout(() => ctl.abort(new Error('user pressed cancel')), 25);
const aState = new NodeStateBase();
const aResult = await dispatcher.execute('slow-dag', aState, { "signal": ctl.signal });
process.stdout.write(`cancelled → ${aState.lifecycle.kind}, cursor=${aResult.cursor}\n`);

// (b) Deadline timeout
const bState = new NodeStateBase();
const bResult = await dispatcher.execute('slow-dag', bState, { "deadlineMs": 25 });
process.stdout.write(`deadline → ${bState.lifecycle.kind}, cursor=${bResult.cursor}\n`);
```

## What it demonstrates

- The `slow` node propagates `context.signal` to an internal `setTimeout` via a listener — when the signal fires, the timeout is cleared and the promise rejects, terminating the node cleanly.
- `lifecycle.kind === 'cancelled'` when the caller's `AbortController` fires.
- `lifecycle.kind === 'timed_out'` when `deadlineMs` expires (the dispatcher uses `AbortSignal.timeout` internally).
- `result.cursor` holds the `'slow'` node name in both cases — the DAG stopped mid-execution and can be resumed from that cursor.
- The dispatcher never throws. Both cancellation paths reach a final `ExecutionResultInterface` with the lifecycle reflecting what happened.

## See also

- [Cancellation](../guide/cancellation)
- [Checkpoint](../guide/checkpoint) — abort + persist for resume

## Related reference

- [Reference: Runtime — `SignalComposer`](../reference/runtime)
- [Reference: Contracts — `ExecuteOptionsInterface`](../reference/contracts)
- [Reference: Lifecycle](../reference/lifecycle)
