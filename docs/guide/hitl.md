# HITL park-and-correlate

Human-in-the-loop (HITL) flows need to pause execution and wait for an external
decision — an approval, a form submission, a webhook — before continuing. The
Dagonizer engine provides a first-class primitive for this: **park-and-correlate**.

## Design: park-and-correlate vs. engine-suspend

The primitive does **not** suspend the engine. Node processes, workers, and
containers remain free; the flow simply terminates early with a well-defined
exit state. The caller persists the checkpoint and re-invokes when the decision
arrives. This matches how serverless and queue-based architectures work: a
function call parks, stores its state in a database, and resumes when a new
invocation arrives.

The three artifacts the engine surfaces on a parked result:

| Field | Type | Meaning |
|-------|------|---------|
| `result.parked.correlationKey` | `string` | Opaque key set by the node in state metadata; use it to correlate a webhook/callback with the parked run |
| `result.parked.cursor` | `string` | Placement name to pass to `dispatcher.resume()` |
| `result.parked.dagName` | `string` | DAG name to pass to `dispatcher.resume()` |
| `result.cursor` | `string \| null` | Same as `parked.cursor`; present for `Checkpoint.capture()` |
| `result.state.lifecycle.variant` | `'awaiting-input'` | Non-terminal lifecycle variant; the run can resume |

## Authoring a parking node

A node parks by:

1. Writing a `correlationKey` to state metadata before routing.
2. Routing to the reserved `'parked'` output.

The engine intercepts the `'parked'` output before the placement-level routing
map is consulted, so the DAG does **not** need a `'parked' → nextNode` entry.

```ts
class ApproveNode extends ScalarNode<MyState, 'parked' | 'approved' | 'rejected'> {
  readonly name = 'approve';
  readonly outputs = ['parked', 'approved', 'rejected'] as const;

  protected override async executeOne(state: MyState) {
    if (state.decision === 'approved') return NodeOutputBuilder.of('approved');
    if (state.decision === 'rejected') return NodeOutputBuilder.of('rejected');

    // Park: write the correlationKey so the caller can correlate the resume.
    state.setMetadata('correlationKey', `approval:${state.requestId}`);
    return NodeOutputBuilder.of('parked');
  }
}
```

The DAG placement lists `'parked'` in the node's `outputs` array (declared on the
class) but does NOT list it in the placement's `outputs` routing map:

```ts
{
  '@id':     'urn:noocodex:dag:my-flow/node/approve',
  '@type':   'SingleNode',
  'name':    'approve',
  'node':    'approve',
  // 'parked' is intentionally absent — the engine intercepts it.
  'outputs': { 'approved': 'process', 'rejected': 'rejected-end' },
}
```

## The ParkedType entity

```ts
type ParkedType = {
  correlationKey: string;  // opaque, set by the node
  cursor: string;          // placement name; pass to dispatcher.resume()
  dagName: string;         // DAG name; pass to dispatcher.resume()
};
```

`result.parked` is `null` when the flow ran to a terminal without parking.
Check `result.parked !== null` before reading its fields.

## Full lifecycle

```ts
// 1. Initial execute — parks at 'approve'
const firstResult = await dispatcher.execute('my-flow', initialState);
// firstResult.state.lifecycle.variant === 'awaiting-input'
// firstResult.parked.correlationKey  === 'approval:req-001'
// firstResult.parked.cursor          === 'approve'

// 2. Capture checkpoint (persist: DB, queue, etc.)
const ckpt = await Checkpoint.capture('my-flow', firstResult);
await db.save(firstResult.parked.correlationKey, ckpt.toJson());

// --- Human makes a decision (out of band) ---

// 3. On webhook/callback: restore and apply decision
const raw = await db.load(correlationKey);
const recalled = Checkpoint.load(JSON.parse(raw));
const { state, dagName, cursor } = recalled.restoreState(
  CheckpointRestoreAdapter.wrap((snap) => MyState.restore(snap)),
);
state.decision = 'approved'; // inject the human decision

// 4. Resume — re-enters at the parked placement
const finalResult = await dispatcher.resume(dagName, state, cursor);
// finalResult.state.lifecycle.variant === 'completed'
// finalResult.parked                  === null
```

## Lifecycle state

The `'awaiting-input'` lifecycle variant is **not terminal**. `isTerminal()`
returns `false` for it; `isParked()` returns `true`. The scheduler resets
the lifecycle on `resume()` before calling `markRunning()`, exactly as it does
for crash-recovery resumes from terminal states.

The `correlationKey` field on the lifecycle state (`state.lifecycle.correlationKey`)
reflects the key stored in the `awaiting-input` state object. It is `null` on
all other variants.

## NodeStateBase helpers

`NodeStateBase` exposes two conveniences:

```ts
// Transition to awaiting-input and store the correlationKey in metadata.
// Equivalent to what ApproveNode.executeOne above does by hand.
state.park('approval:req-001');

// True iff lifecycle.variant === 'awaiting-input'
state.parked; // boolean
```

The engine calls `state.park(correlationKey)` automatically when it detects a
`'parked'` output, so nodes do not need to call it manually — just route to
`'parked'` and write the key to metadata.

## Example

See [Example 31: HITL park-and-correlate](/examples/31-hitl) for a complete
runnable demonstration including a two-node approval flow, checkpoint capture,
simulated human decision, and resume.
