---
'@studnicky/dagonizer': major
---

`ScatterNode`'s three uncoordinated concurrency knobs (`concurrency`, `throttle`, `reservoir`) collapse into one discriminated `execution: { mode: 'item', concurrency?, throttle? } | { mode: 'reservoir', concurrency?, reservoir }` field. The schema now structurally prevents combining `throttle` with `reservoir` — previously that combination silently did nothing. `concurrency` applies in both modes (item-level semaphore vs. batch-level semaphore); `throttle` is `mode: 'item'`-only. `DAGBuilder.scatter`'s `ScatterOptionsType` gains `execution` in place of the flat `concurrency`/`reservoir` fields. Migration: `scatter.concurrency: N` → `scatter.execution: { mode: 'item', concurrency: N }`; `scatter.reservoir: {...}` → `scatter.execution: { mode: 'reservoir', reservoir: {...} }` (add `concurrency` alongside `reservoir` inside `execution` if it was previously set).
