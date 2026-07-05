# Example 31: HITL park-and-correlate

A human-in-the-loop approval flow that parks mid-execution and resumes after a
simulated human decision.

**Run:** `npx tsx examples/31-hitl.ts`

## What it shows

- A node routes to the reserved `'parked'` output to pause execution.
- The engine transitions the lifecycle to `awaiting-input` (non-terminal).
- `result.parked` carries the `correlationKey`, `cursor`, and `dagName`.
- `Checkpoint.capture()` works identically on a parked result (`cursor` is set).
- `dispatcher.resume()` re-enters at the parked placement with the decision applied.

## Flow

```
prepare → approve ──park──▶ [awaiting-input]
                  ◀──resume─ (human sets decision)
                  ──approved──▶ process → end (completed)
                  ──rejected──▶ rejected-end (failed)
```

## Source

@[code ts](../../examples/31-hitl.ts)

### DAG definition

@[code ts](../../examples/dags/31-hitl.ts)

## Key concepts

| Concept | Code |
|---------|------|
| Write correlationKey | `state.setMetadata('correlationKey', key)` |
| Route to park | `return RoutedBatchBuilder.of('parked', Batch.from(parked))` |
| Detect parked result | `result.parked !== null` |
| Extract cursor | `result.parked.cursor` |
| Capture checkpoint | `Checkpoint.capture('dag', result)` |
| Resume with decision | `dispatcher.resume(dagName, state, cursor)` |

See [HITL park-and-correlate guide](/guide/hitl) for the full design rationale and
API reference.
