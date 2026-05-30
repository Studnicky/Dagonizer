---
'@noocodex/dagonizer': patch
---

CompositeLayout now positions the synthetic `END` node. Previously a DAG with `null`-route (terminal) placements left `END` out of the dagre graph, so cytoscape defaulted it to `(0,0)` and produced a graph-spanning edge to it. `END` is now added to the top-level dagre graph with edges from every null-route placement, so it ranks below its predecessors instead of stranding at the origin.
