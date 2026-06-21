---
"@studnicky/dagonizer": minor
---

Visualization: `MermaidRenderer.render(dag, options?)` and a framework-agnostic `MermaidExplorer`.

- **`MermaidRenderer.render(dag, options?)`** gains a `MermaidRenderOptionsType` (`orientation` default `'TB'`, `sanitizeNodeIds` default `true`, `terminalAnnotations` default `'strip'`, and a concrete-colour `theme` with per-role `containerTints`). The renderer now emits parse-safe Mermaid by default: colon-bearing placement ids are sanitized to keyword-safe ids (labels keep their colons), `\n(outcome)` terminal annotations that break the lexer are stripped, and the orientation is configurable. Existing `render(dag)` callers get the safe output with no change.
- **`MermaidExplorer`** (`@studnicky/dagonizer/viz`) is a vanilla-TS, framework-agnostic enhancer that attaches the same D-pad (zoom · pan ×4 · centre · fit) and fullscreen-explore modal to rendered Mermaid SVGs that the interactive graph canvases use — one consistent navigation rule set across diagrams and live graphs. `MermaidExplorer.install(options?)` wires a `MutationObserver` for async-rendered diagrams; `MermaidExplorer.enhance(frame, options?)` upgrades one. A companion stylesheet ships at `@studnicky/dagonizer/viz/explorer.css`.
