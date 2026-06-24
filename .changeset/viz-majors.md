---
"@studnicky/dagonizer": minor
---

Bumps two visualization dev dependencies to their new major versions:
`@cosmos.gl/graph` from ^2.6.4 to ^3.0.0 and `cytoscape-dagre` from ^3.0.0
to ^4.0.0.

`@cosmos.gl/graph` v3 introduces a luma.gl (WebGL 2) rendering engine and a
config API change where `setConfig()` now resets all values to defaults — use
the new `setConfigPartial()` to update individual properties without a full
reset. In this workspace cosmos is consumed only by the docs memory-graph
component (`docs/.vitepress/theme/components/MemoryGraph.vue`); every config
key, callback, and `Graph` method that component uses (`simulationDecay`,
`onSimulationTick`, `onZoom`, `onClick`, `setPointPositions`, `getZoomLevel`,
`render`, `spaceToScreenPosition`, …) is present and signature-compatible in
v3, and the component never calls `setConfig`, so the reset-behavior change
does not apply.

`cytoscape-dagre` v4 ships its own bundled TypeScript declarations. It has no
importer in this workspace — the dagonizer viz layer drives layout via
`@dagrejs/dagre` directly rather than the cytoscape-dagre plugin — so the bump
is config-only. Consumers using the cytoscape-dagre layout should note the new
`useDagreEdgeControlPoints`, `automaticDagreEdgeStyle`, and `dagreEdgeStyle`
options available in v4.
