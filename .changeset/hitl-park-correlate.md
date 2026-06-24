---
"@studnicky/dagonizer": minor
---

First-class HITL park-and-correlate primitive. A node that routes to the
reserved `'parked'` output causes the engine to transition the run lifecycle to
`awaiting-input`, set `result.cursor` to the parked placement, and populate
`result.parked` with a `ParkedType` carrying `correlationKey`, `cursor`, and
`dagName`. The caller captures a checkpoint and calls `dispatcher.resume()` when
the human decision arrives. The `DAGLifecycleMachine` gains the `awaiting-input`
variant and `park` event; `NodeStateBase` gains `park()` and a `parked` getter;
`ExecutionResultType` gains `parked: ParkedType | null`; `Validator.parked` is
added; the `DAGValidator` skips the reserved `'parked'` output in the routing
completeness check.
