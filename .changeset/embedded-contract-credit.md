---
'@noocodex/dagonizer': patch
---

`registerDAG` now credits the co-located contract of `EmbeddedDAGNode` and `ScatterNode` placements (resolved by placement name), not just `SingleNode` placements. Previously, an operation rendered as an embedded-DAG or scatter placement was dropped from the contract graph, so a downstream node reading its `produces` was wrongly flagged as a dangling read and `registerDAG` threw `DAGError`. Fixes the `examples/derive.ts` embedded-DAG flow, which failed contract validation at registration.
