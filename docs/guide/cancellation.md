---
seeAlso:
  - text: 'Retry'
    link: './retry'
    description: '`RetryPolicy.run` honors `context.signal` so retries abort cleanly'
  - text: 'Checkpoint'
    link: './checkpoint'
    description: 'abort + persist the cursor so the next process can resume'
  - text: 'Observability'
    link: './observability'
    description: '`onError` fires when an abort or deadline interrupts a node'
---

# Cancellation

Cancellation flows through the standard Web `AbortSignal` API. The dispatcher accepts two optional parameters in the `execute()` / `resume()` options object.

## `signal` and `deadlineMs`

```ts
// Caller-controlled abort
const ctl = new AbortController();
const result = await dispatcher.execute('my-flow', state, { signal: ctl.signal });

// Hard deadline (ms from now)
const result = await dispatcher.execute('my-flow', state, { deadlineMs: 5_000 });

// Both: whichever fires first wins
const result = await dispatcher.execute('my-flow', state, {
  signal: ctl.signal,
  deadlineMs: 5_000,
});
```

Internally the dispatcher calls `AbortSignal.any([signal, AbortSignal.timeout(deadlineMs)])`. The composed signal is the one passed to every node.

## `NodeContextInterface`

Nodes receive the composed signal in the `context` argument:

```ts
import type { NodeContextInterface, NodeInterface } from '@noocodex/dagonizer';
import { NodeStateBase } from '@noocodex/dagonizer';

const fetchNode: NodeInterface<NodeStateBase, 'success' | 'error'> = {
  name: 'fetch',
  outputs: ['success', 'error'],
  async execute(state, context) {
    try {
      const data = await fetch('https://api.example.com/data', {
        signal: context.signal,   // propagate to IO
      });
      state.setMetadata('data', await data.json());
      return { output: 'success' };
    } catch {
      return { output: 'error' };
    }
  },
};
```

`context` also carries `context.dagName` and `context.nodeName` for logging.

## Detecting abort inside a node

```ts
async execute(state, context) {
  for (const item of items) {
    if (context.signal.aborted) break;   // check between iterations
    await process(item, context.signal); // propagate to every IO call
  }
  return { output: 'success' };
}
```

## After cancellation

Once the signal fires:

⦿ The iterator stops without starting the next node.
⦿ `result.cursor` holds the node that would have run next — pass it to `dispatcher.resume()` to continue from that point.
⦿ `result.state.lifecycle.kind` is `'cancelled'` (caller signal) or `'timed_out'` (deadline).

```ts
const ctl = new AbortController();
setTimeout(() => ctl.abort(new Error('user cancelled')), 500);

const result = await dispatcher.execute('pipeline', state, { signal: ctl.signal });

if (result.cursor !== null) {
  // Interrupted — resume later.
  console.log('paused at', result.cursor);
  console.log('lifecycle', result.state.lifecycle.kind); // 'cancelled'
}
```

## Signal composition

The dispatcher uses `AbortSignal.any()` to merge signals. Callers can do the same to compose multiple concerns before passing them in:

```ts
const userSignal = userAbortController.signal;
const requestSignal = AbortSignal.timeout(10_000);
const combined = AbortSignal.any([userSignal, requestSignal]);

const result = await dispatcher.execute('flow', state, { signal: combined });
```

This is equivalent to passing both as `signal` + `deadlineMs` — choose whichever form fits the call site.
## Related reference

⦿ [Reference: Runtime — `SignalComposer`](../reference/runtime)
⦿ [Reference: Contracts — `ExecuteOptionsInterface`](../reference/contracts)
⦿ [Example: Cancellation](../examples/06-cancellation)
