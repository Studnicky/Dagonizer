---
"@studnicky/dagonizer": patch
---

Fix: self-loop edges (retry/parked) render as visible loops instead of being skipped with 'invalid endpoints'. `CytoscapeRenderer.placementEdges` tags edges where source === target with a `self-loop` class; `CytoscapeGraph.stylesheet` adds an `edge.self-loop` rule with `curve-style: bezier` that overrides the base `round-taxi` style, which cannot draw self-loops.
