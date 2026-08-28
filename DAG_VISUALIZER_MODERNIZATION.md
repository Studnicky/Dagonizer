# Dagonizer DAG Visualizer Modernization

## Purpose

This document reviews the current Dagonizer DAG visualization stack and defines how it should evolve so downstream Dagonizer users can visualize their own DAGs more easily.

This is not a proposal for a generic Mermaid or generic graph product.

The target is a better consumer-facing visualization surface for people who adopt the Dagonizer framework and need to:

- render DAGs in docs and READMEs;
- embed DAG inspection into their own apps;
- present expanded embedded-DAG topology clearly;
- attach runtime or domain-specific annotations;
- theme the viewer to match their product;
- switch between static, interactive, and live execution views.

## Current architecture

The current visualization system is split across three layers.

| Layer | Current implementation | Responsibility |
|---|---|---|
| Static diagram rendering | `MermaidRenderer.render(dag, options?)` | emits Mermaid flowchart source from `DAGType` |
| Structured interactive graph rendering | `CytoscapeRenderer.render(dag, options?)`, `CytoscapeGraph` | emits graph elements, computes layout, mounts Cytoscape |
| Docs/demo interaction layer | `MermaidExplorer`, `AnimatedDagGraph`, `DagJsonMermaid`, docs-side wrappers | adds controls, animation, expand/collapse behavior, docs-specific styling |

This split is mostly correct. The problem is where the best user experience currently lives.

## What consumers already get

### Mermaid path

`MermaidRenderer.render(dag, options?)` already gives consumers a usable static representation.

Current strengths:

- orientation control;
- node-id sanitization;
- terminal-annotation cleanup;
- theme colors;
- container-role tint overrides;
- Dagonizer-aware placement shapes and route labels.

This is good for:

- static docs;
- markdown snippets;
- README diagrams;
- search-indexable content;
- lightweight exports where no interactive graph is needed.

### Cytoscape path

`CytoscapeRenderer.render(dag, options?)` and `new CytoscapeGraph(container, dag, options)` already give consumers the real graph model.

Current strengths:

- typed node and edge elements;
- placement-type semantics;
- terminal outcome metadata;
- embedded-DAG expansion through a registry;
- recursive compound rendering;
- separate layout step;
- subclass hooks in `CytoscapeGraph`.

This is the real foundation for a consumer-grade DAG viewer.

## Where the current system falls short

The current package gives the right primitives, but not the right product surface.

### 1. The best experience is docs-only

The strongest interaction model currently lives in docs/demo code, not in the package surface.

Examples:

- `AnimatedDagGraph` adds:
  - expand/collapse behavior;
  - readable initial view;
  - node variants;
  - camera behavior;
  - live-run animation;
  - richer interaction defaults.

That is exactly the sort of behavior downstream consumers will want, but it is not the default package story.

### 2. The consumer API is too low-level

Current package consumers mostly choose between:

- “give me Mermaid source”; or
- “give me Cytoscape elements / a base graph object”.

That is useful for library authors, but thin for application developers.

Most Dagonizer consumers want:

- a mountable viewer;
- a predictable theme surface;
- a way to expand embedded DAGs;
- a way to attach status/badges/labels;
- a way to respond to selection/click/focus events.

### 3. Parameterization is narrow in the wrong places

There are already some theme knobs, but the meaningful consumer needs are larger:

- compact vs detailed labels;
- selected embedded-DAG expansion;
- domain-specific node annotations;
- runtime status overlays;
- variant styling;
- tooltip content;
- interactive controls;
- live/inspect/static display modes.

The package should expose those intentionally instead of making consumers subclass deeply or mutate raw elements ad hoc.

### 4. Static and interactive views are parallel products

The Mermaid and Cytoscape outputs are both useful, but they feel like separate tracks rather than two views over one coherent visualization model.

Consumers often want:

- a static representation for docs; and
- an interactive representation for an app;

using the same DAG semantics and roughly the same visual language.

## What should stay Dagonizer-specific

The goal is not to erase Dagonizer semantics into a generic graph viewer.

The following should remain first-class:

- placement types;
- scatter/gather meaning;
- embedded-DAG meaning;
- terminal outcomes;
- route labels;
- container-role semantics;
- reservoir semantics;
- recursive embedded-DAG expansion.

Those are the reasons a Dagonizer visualizer is valuable.

The reusable part is not “graph drawing in general.”

The reusable part is “high-quality visualization of Dagonizer execution topology.”

## Modernization direction

The correct move is to productize the Dagonizer viewer stack.

### Keep the existing structural split

- `MermaidRenderer` stays the static/export layer.
- `CytoscapeRenderer` stays the structural graph layer.
- `CytoscapeGraph` stays the low-level mountable foundation.

### Add a new consumer-facing layer

Introduce a first-class package surface above `CytoscapeGraph`, for example:

`DagViewer`

This becomes the default answer for downstream users who want to visualize DAGs in an application or docs UI.

## Recommended package surface

### `DagViewer`

The package should expose a mountable viewer with Dagonizer-aware defaults.

Just as importantly, it should not hide the underlying Mermaid or Cytoscape configuration surfaces behind a narrow wrapper API.

Configuration policy should be:

- full pass-through to Mermaid options where Mermaid is the rendering backend;
- full pass-through to Cytoscape options where Cytoscape is the rendering backend;
- Dagonizer-owned defaults layered in first;
- schema-merged override behavior so consumers only specify what they want to change.

That means the package should feel opinionated by default, but never boxed in.

Example shape:

```ts
const viewer = new DagViewer(container, {
  dag,
  embeddedDAGs,
  theme,
  expand,
  annotations,
  interactions,
  initialMode,
});

await viewer.mount();
```

Recommended shape:

```ts
const viewer = new DagViewer(container, {
  dag,
  embeddedDAGs,
  theme,
  expand,
  annotations,
  interactions,
  initialMode,
  cytoscape: {
    layout: { name: 'preset' },
    minZoom: 0.05,
    maxZoom: 6,
  },
});
```

This viewer should own:

- element composition;
- layout application;
- default stylesheet;
- camera controls;
- embedded-DAG expand/collapse;
- selection and focus behavior;
- optional tooltips;
- status/annotation overlays;
- default inspect-mode interactions.

`CytoscapeGraph` remains for lower-level customization.

`DagViewer` becomes the consumer product surface.

### Configuration contract

The package should define configuration merging explicitly.

#### Mermaid

For static rendering, callers should be able to pass through Mermaid-facing options fully, while Dagonizer still supplies safe defaults.

Conceptually:

```ts
MermaidRenderer.render(dag, {
  ...dagonizerDefaults.mermaid,
  ...userOptions,
});
```

But the merge should be schema-aware rather than shallow where nested objects exist, especially for `theme`.

Desired behavior:

- Dagonizer provides defaults for:
  - orientation;
  - id sanitization;
  - terminal cleanup;
  - Dagonizer role/container styling;
  - base theme values.
- consumer options override only the fields they set.
- unsupported keys are not invented by the wrapper.

#### Cytoscape

For interactive rendering, the consumer should be able to pass through Cytoscape options fully, while Dagonizer still applies sane viewer defaults.

Conceptually:

```ts
new DagViewer(container, {
  dag,
  cytoscape: userCytoscapeOptions,
});
```

with merge behavior like:

```ts
resolved = mergeDagViewerSchema({
  ...dagonizerDefaults.viewer,
  cytoscape: dagonizerDefaults.cytoscape,
}, userOptions);
```

The wrapper should not force consumers to abandon normal Cytoscape options just because they are using Dagonizer.

#### Schema merge, not ad hoc spread logic

This matters enough that the merge policy should be formalized.

Recommended rules:

- objects merge recursively by schema;
- arrays are replace-by-default unless the schema says otherwise;
- scalar fields override;
- `undefined` means “use default”;
- explicit `null` is only allowed where the schema permits disabling behavior;
- backend pass-through sections (`mermaid`, `cytoscape`) preserve native option names.

This avoids fragile hand-rolled merging and keeps the consumer contract predictable.

### Stable annotation contract

Consumers need a supported way to enrich nodes and edges.

Example shape:

```ts
type DagViewerAnnotations = {
  nodeStatus?: Record<string, 'idle' | 'active' | 'completed' | 'failed'>;
  nodeBadges?: Record<string, readonly Badge[]>;
  edgeBadges?: Record<string, readonly Badge[]>;
  nodeVariant?: Record<string, string>;
  groups?: Record<string, string>;
};
```

Or hook-based enrichment:

```ts
type DagViewerHooks = {
  mapNode?(placement, context): Partial<DagViewNodeMeta>;
  mapEdge?(edge, context): Partial<DagViewEdgeMeta>;
};
```

This is materially better than asking consumers to patch raw Cytoscape elements themselves.

### Stable theme contract

The package should expose a `DagViewerTheme` instead of leaving consumers to derive one from docs stylesheets or raw Cytoscape selectors.

Recommended theme sections:

- node type styles;
- edge styles;
- container role styles;
- terminal outcome styles;
- status styles;
- typography;
- controls chrome;
- background/grid treatment.

Consumers should be able to change branding without changing renderer logic.

### Shared control chrome contract

Status in the current codebase:

- implemented as a package-owned state machine in `packages/dagonizer/src/viz/DpadMachine.ts`;
- implemented as a shared camera command surface in `packages/dagonizer/src/viz/CameraControls.ts`;
- implemented as a shared legend/filter state surface in `packages/dagonizer/src/viz/LegendMachine.ts`;
- implemented as shared chrome and placement styles in:
  - `packages/dagonizer/src/viz/Dpad.css`
  - `packages/dagonizer/src/viz/ModalShell.css`;
- consumed by:
  - `docs/.vitepress/theme/components/DagGraph.vue`
  - `docs/.vitepress/theme/components/MemoryGraph.vue`
  - `packages/dagonizer/src/viz/MermaidExplorer.ts`

So this section is no longer purely aspirational. The remaining work is to extend the same treatment to the other visualizer surfaces below.

The current codebase already proves the control surface across all three renderers, but it is not actually shared.

Concrete findings from the code:

- `docs/.vitepress/theme/components/graph/GraphDpad.vue` is the canonical Vue control used by:
  - `docs/.vitepress/theme/components/DagGraph.vue`
  - `docs/.vitepress/theme/components/MemoryGraph.vue`
- `packages/dagonizer/src/viz/MermaidExplorer.ts` re-implements the same 3×3 control grid imperatively with:
  - its own button factory (`#btn`);
  - its own inline-diagram D-pad builder (`#dpad`);
  - a second modal-only D-pad builder inside `#modal`;
  - a separate CSS namespace in `packages/dagonizer/src/viz/explorer.css`.

This means the project currently has one shared visual contract but multiple code paths for the same control.

The duplicated contract is already visible in the code:

- same 3×3 layout;
- same glyph set;
- same tooltips;
- same zoom step (`1.25`);
- same pan step (`80px`);
- same center and fit semantics;
- same bottom-right anchoring;
- same expand-slot intent in inline mode.

What differs is not the control itself. What differs is the adapter behind each action.

That is the correct extraction boundary.

#### What should become shared

Make the D-pad a package-owned control contract with these shared pieces:

- action ids:
  - `zoom-in`
  - `pan-up`
  - `zoom-out`
  - `pan-left`
  - `centre`
  - `pan-right`
  - `expand`
  - `pan-down`
  - `fit`
- canonical labels, glyphs, and titles;
- canonical ordering in the 3×3 grid;
- canonical chrome tokens:
  - surface;
  - stroke;
  - accent;
  - text;
  - radius;
  - spacing;
  - opacity states;
- canonical sizing:
  - 32×32 buttons;
  - 4px gaps;
  - 6px pad;
- optional zoom HUD contract for renderers that can report zoom level.

These are renderer-independent.

#### What should stay renderer-specific

The action implementations must stay adapter-owned.

Current renderer differences in the code:

- Cytoscape (`AnimatedDagGraph`) already exposes direct camera methods:
  - `zoomIn()`
  - `zoomOut()`
  - `panUp()`
  - `panDown()`
  - `panLeft()`
  - `panRight()`
  - `centerView()`
  - `fitScreen()`
- cosmos (`MemoryGraph.vue`) cannot pan a camera directly, so it simulates pan by shifting all point positions in world space through `mgPanBy()`.
- Mermaid (`MermaidExplorer.ts`) owns its own transform camera via `{ scale, tx, ty }` and applies pan/zoom by rewriting the SVG transform.

So the unification target is not one camera implementation.

The unification target is one reusable control element plus one action contract that each renderer binds to.

#### Recommended implementation shape

Model the control as one generic FSM with visualization hooks.

The package-owned machine should own:

- canonical button ordering;
- canonical labels and titles;
- inline vs modal lower-left slot behavior;
- disabled-state resolution;
- zoom HUD state;
- press semantics.

The visualization should supply only hooks for what each action actually does.

Example shape:

```ts
type DpadAction =
  | 'zoom-in'
  | 'pan-up'
  | 'zoom-out'
  | 'pan-left'
  | 'centre'
  | 'pan-right'
  | 'expand'
  | 'close'
  | 'pan-down'
  | 'fit';

const machine = new DpadMachine({
  can(action) {
    return true;
  },
  run(action) {
    // visualization-owned behavior
  },
  getZoomLevel() {
    return 1.25;
  },
});
```

This keeps the control unified without forcing MermaidExplorer onto Vue or forcing the package to depend on a framework.

#### Concrete refactor targets

The code points that should change are clear.

Shared extraction target:

- package-owned shared machine:
  - `packages/dagonizer/src/viz/DpadMachine.ts`

Vue side:

- `docs/.vitepress/theme/components/graph/GraphDpad.vue`
  - replace hard-coded nine buttons with rendering from machine state;
  - keep only Vue rendering and optional zoom HUD behavior.

Mermaid side:

- `packages/dagonizer/src/viz/MermaidExplorer.ts`
  - replace `#dpad` button-by-button construction with one renderer over shared machine state;
  - replace modal button-by-button construction with the same machine in `modal` mode so the lower-left slot becomes `close`;
  - keep camera math and modal lifecycle local.
- `packages/dagonizer/src/viz/explorer.css`
  - stop diverging from the Vue control chrome;

### Additional visualizer surfaces that should get the same treatment

The D-pad was the clearest first extraction because it already had one semantic contract across three renderers.

That same pattern still exists elsewhere in the codebase.

These are the next shared-surface candidates, based on the current implementation rather than speculative product ideas.

#### 1. Fullscreen / modal controller

Status in the current codebase:

- shell styling is already shared through `packages/dagonizer/src/viz/ModalShell.css`;
- a shared controller now exists in `packages/dagonizer/src/viz/ModalController.ts`;
- that controller is exported from `packages/dagonizer/src/viz/index.ts`;
- it is now integrated into:
  - `docs/.vitepress/theme/components/DiagramFrame.vue`
  - `packages/dagonizer/src/viz/MermaidExplorer.ts`
- fullscreen lifecycle is still partially split because true browser fullscreen remains local to `DiagramFrame.vue`.

Concrete findings from the code:

- `ModalController.ts` now owns shared lifecycle semantics for:
  - `open()`
  - `close(reason)`
  - `toggle()`
  - `onKeyDown(key)`
  - `onBackdropPress(isBackdropTarget)`
- `DiagramFrame.vue` still owns:
  - `isFullscreen`
  - `toggleFullscreen()`
  - Fullscreen API subscription through `fullscreenchange`
- `DiagramFrame.vue` now delegates expanded-modal lifecycle through the shared controller instead of mutating `expanded` directly.
- `MermaidExplorer.ts` now delegates modal open/close, Escape dismissal, and backdrop dismissal through the shared controller instead of a private `#dismiss(...)` path.

The result is no longer two unrelated controller models. The expanded-modal lifecycle is now shared; browser fullscreen remains renderer-host-specific.

What is still split:

- fullscreen API entry and exit;
- renderer-specific mount / teardown content;
- resize / fit follow-up behavior after open and close;
- focus targeting beyond the current shell defaults.

Before this extraction, lifecycle was fully split between:
  - `docs/.vitepress/theme/components/DiagramFrame.vue`
  - `packages/dagonizer/src/viz/MermaidExplorer.ts`

What should become shared:

- open / close semantics;
- expand vs true fullscreen fallback policy;
- Escape handling;
- backdrop click policy;
- body scroll locking;
- focus target / accessibility defaults;
- resize notification hooks after state changes;
- modal-mode placement of shared controls and hint surfaces.

What should stay renderer-specific:

- the actual diagram content;
- SVG cloning and transform camera in Mermaid;
- browser Fullscreen API integration in the Vue frame host;
- renderer-specific resize / fit behavior after open and close.

Recommended extraction target:

- `packages/dagonizer/src/viz/ModalController.ts`

That controller is now the right framework-neutral seam for the expanded-modal path. The remaining work is to decide whether true fullscreen should stay host-local or be represented through a wider shared viewport-shell contract.

#### 2. Viewport status HUD

Status in the current codebase:

- a minimal shared contract now exists in `packages/dagonizer/src/viz/ViewportStatus.ts`;
- it is consumed by:
  - `docs/.vitepress/theme/components/DagGraph.vue`
  - `docs/.vitepress/theme/components/MemoryGraph.vue`
  - `packages/dagonizer/src/viz/MermaidExplorer.ts`

Concrete findings from the code:

- all three renderers now surface the same basic hint string:
  - inline: `drag · wheel`
  - modal: `drag · wheel · esc to close`
- the HUD is still effectively just a D-pad adjunct, not a fuller viewer status surface.

What should become shared next:

- zoom level formatting;
- mode (`inline` / `modal`);
- interaction hint text;
- optional fit / pan availability;
- optional runtime or simulation state badges;
- optional “reduced motion” or “live animation” status.

Why this is the right boundary:

The HUD is not a Cytoscape feature or a Mermaid feature. It is viewer chrome. The current code already proves that each renderer can supply the raw state.

Recommended extraction target:

- extend `packages/dagonizer/src/viz/ViewportStatus.ts` into a broader status model instead of leaving the HUD as a plain hint string.

#### 3. Toolbar / action-strip contract

Status in the current codebase:

- a shared action descriptor now exists in `packages/dagonizer/src/viz/ViewerActions.ts`;
- shared action chrome now exists in `packages/dagonizer/src/viz/ViewerActions.css`;
- the action surface is now exported from `packages/dagonizer/src/viz/index.ts`;
- a shared docs-side renderer now exists in `docs/.vitepress/theme/components/graph/ViewerActions.vue`;
- that shared renderer is now integrated into:
  - `docs/.vitepress/theme/components/DiagramFrame.vue`
  - `docs/.vitepress/theme/components/MemoryGraph.vue`
- actions are still partially split across:
  - `DiagramFrame.vue` header buttons;
  - `GraphDpad.vue`;
  - Mermaid modal controls via `MermaidExplorer.ts`.

Concrete findings from the code:

- `ViewerActions.ts` now owns shared action metadata for:
  - `expand`
  - `fullscreen`
  - `clear`
- `ViewerActions.vue` now renders shared button metadata instead of each host hand-authoring button markup.
- `DiagramFrame.vue` now derives its header actions from the shared model rather than hard-coded header buttons.
- `MemoryGraph.vue` now derives its top-right clear action from the shared model rather than a bespoke `.mg-clear` button contract.
- `GraphDpad.vue` and Mermaid modal controls still use the D-pad-specific action path, so the overall viewer action vocabulary is not fully unified yet.

What should become shared:

- action ids;
- grouping and placement rules;
- button metadata:
  - label;
  - icon/glyph;
  - title;
  - disabled state;
  - active state;
- keyboard shortcut metadata;
- common styling tokens for toolbar actions and in-canvas actions.

What should stay renderer-specific:

- whether an action appears in the header, overlay, or modal;
- actual command handlers;
- renderer-specific actions such as “clear memory”.

Recommended extraction target:

- a package-owned `ViewerActionModel` that can drive:
  - D-pad rendering;
  - header action rendering;
  - modal action rendering;
  - future export/search/inspect actions.

That work is now partially implemented for header and overlay actions. The remaining step is to unify D-pad and modal actions under the same broader viewer action vocabulary without collapsing the existing camera-control FSM.

#### 4. Overlay panel system

Status in the current codebase:

- shared overlay chrome now exists in `packages/dagonizer/src/viz/ViewerOverlay.css`;
- a shared docs-side renderer now exists in `docs/.vitepress/theme/components/graph/ViewerOverlay.vue`;
- that shared renderer is now integrated into:
  - `docs/.vitepress/theme/components/DagGraph.vue`
  - `docs/.vitepress/theme/components/MemoryGraph.vue`
- overlay panels are still only partially unified because Mermaid does not yet consume the same overlay surface.

Concrete findings from the code:

- `DagGraph.vue` now renders loading and error states through `ViewerOverlay.vue`.
- `MemoryGraph.vue` now renders loading, error, and empty states through `ViewerOverlay.vue`.
- the old bespoke state-specific overlay classes were removed from those two graph hosts.
- Mermaid currently has modal hint UI but no comparable shared overlay panel model.

This viewer chrome is no longer duplicated across the two Vue graph surfaces, but it is not yet fully shared across every renderer path.

What should become shared:

- loading state panel;
- error state panel;
- empty state panel;
- in-canvas action panel placement rules;
- consistent border, blur, surface, spacing, and typography tokens.

What should stay renderer-specific:

- error text;
- empty-state copy;
- renderer-specific recovery actions.

Recommended extraction targets:

- `docs/.vitepress/theme/components/graph/ViewerOverlay.vue` for the docs layer;
- package-owned overlay tokens alongside `ModalShell.css` and `Dpad.css`.

That work is now implemented for the docs-hosted graph surfaces. The remaining step is to decide whether Mermaid should adopt the same overlay renderer directly, or whether package-owned non-Vue rendering helpers should own the same overlay contract for framework-neutral consumers.

#### 5. Hover / focus / highlight policy

Status in the current codebase:

- a shared selection controller now exists in `packages/dagonizer/src/viz/SelectionController.ts`;
- that controller is exported from `packages/dagonizer/src/viz/index.ts`;
- the shared selection path is now integrated into:
  - `examples/the-archivist/app/ArchivistRunner.vue`
  - `docs/.vitepress/theme/components/TraceFeed.vue`
  - `docs/.vitepress/theme/components/DagGraph.vue`
  - `docs/.vitepress/theme/components/viz/AnimatedDagGraph.ts`
- selection is now partially unified;
- hover and focus semantics are still renderer-local.

Concrete findings from the code:

- `SelectionController.ts` now owns shared selection semantics for:
  - `select(target)`
  - `selectTool(name)`
  - `selectInspect(selection)`
  - `clear()`
  - `selectedTool()`
  - `selectedInspect()`
- `DagGraph.vue` still emits normalized DAG node selection through `dagNodeSelection(...)`, and now also accepts `selectedNode` so host-level selection can feed visible graph emphasis back into the Cytoscape surface.
- `AnimatedDagGraph.ts` now exposes `setInspectedNode(...)` and re-applies that inspected state across rebuilds.
- `CytoscapeGraph.ts` now defines a `node.dag-inspected` style for selected inspection emphasis.
- `MemoryGraph.vue` still emits normalized IRI/literal selection through `iriSelection(...)` and `literalSelection(...)`, and now also accepts `selection` so the current inspected RDF target is visibly emphasized in both point sizing/color and label-pill rendering.
- `MermaidExplorer.ts` now supports click-to-select and clear-selection behavior for rendered Mermaid nodes, with shared visual selected-state emphasis applied through `explorer.css`, but it still does not project those selections into an external inspector-target contract.
- `TraceFeed.vue` no longer owns a completely separate click/highlight contract; it now accepts `selectedTool` and visually highlights the currently inspected tool node from the same shared selection state that drives the inspector.

What should become shared:

- hover target model;
- selected target model;
- clear-selection semantics;
- optional connected-neighbor emphasis policy;
- optional dimming of non-selected content;
- keyboard focus styling and focus-ring tokens.

What should stay renderer-specific:

- how a renderer visually dims or highlights primitives;
- whether hover is implemented through DOM, canvas, or Cytoscape element state.

Recommended extraction targets:

- extend `packages/dagonizer/src/viz/InspectSelection.ts`;
- extend `packages/dagonizer/src/viz/InspectorTarget.ts`;
- add a package-owned interaction/highlight policy surface that downstream surfaces can opt into.

That work is now partially implemented for selected-target, clear-selection, and visible inspected-state parity across the Archivist DAG and memory views. The remaining gap is true hover/focus parity across Cytoscape, cosmos, and Mermaid, plus richer highlight policies such as neighbor emphasis or background dimming.

#### 6. Search / filter / locate surface

Status in the current codebase:

- legend/filter exists;
- graph search / locate does not exist as a shared viewer surface yet.

Concrete findings from the code:

- `LegendMachine.ts` already provides a shared toggle model for layer/kind visibility.
- there is no corresponding shared node-locate or result-navigation surface in the current graph viewers.

This is a meaningful missing primitive for downstream consumers who will use Dagonizer DAGs in real applications.

What should become shared:

- query input contract;
- result list model;
- jump-to-result command;
- next / previous result navigation;
- optional “isolate neighborhood” or “filter to matches” behavior.

Why this belongs in the viewer layer:

Search is not graph-backend-specific. It is a consumer-facing viewer capability that should work regardless of whether the visual backend is Cytoscape, cosmos, or Mermaid.

#### 7. Shared animation scheduler and runtime-truth policy

Status in the current codebase:

- the baseline timing policy is shared through `packages/dagonizer/src/viz/AnimationPolicy.ts`;
- execution of that policy is still backend-local.

Concrete findings from the code:

- `MemoryGraph.vue` uses:
  - `ANIMATION.simulationDecay`
  - `ANIMATION.fitCheckpointsMs`
  - `ANIMATION.fitAnimateMs`
  - `ANIMATION.fitSettleSnapshotMs`
  - `ANIMATION.transitionSnapMs`
- `AnimatedDagGraph.ts` uses the same package policy for the Cytoscape path.
- Mermaid still does not participate in the same runtime-event animation semantics because it is a static explorer with camera interaction only.

What should become shared next:

- mapping from runtime events to visual states:
  - queued
  - active
  - completed
  - failed
  - settled;
- duration caps so animation never outlasts the actual underlying execution without explicit slow-mode intent;
- catch-up behavior when execution finishes faster than the currently visible animation;
- reduced-motion behavior;
- rules for suppressing or shortening transitions during direct user interaction.

Why this matters:

The current policy work is valuable, but it is still mostly timing constants. The next step is a real animation scheduler that treats runtime truth as authoritative and renderer effects as a projection of that truth.

#### 8. Theme-token bridge for viewer chrome

Status in the current codebase:

- token sharing exists in pieces;
- a complete viewer-chrome token layer does not.

Concrete findings from the code:

- D-pad chrome is shared through `Dpad.css`.
- modal shell chrome is shared through `ModalShell.css`.
- Mermaid still carries its own explorer-specific CSS namespace in `packages/dagonizer/src/viz/explorer.css`.
- `MemoryGraph.vue` still defines local overlay/action styles for:
  - `.mg-clear`
  - `.mg-overlay`
  - `.mg-empty`
- `DiagramFrame.vue` still owns its own frame header/action styles locally.

What should become shared:

- viewer panel background tokens;
- border tokens;
- blur tokens;
- text hierarchy tokens;
- action button tokens;
- overlay radius and shadow tokens;
- focus ring tokens;
- motion duration tokens for viewer chrome.

This is the CSS-layer equivalent of the D-pad unification: one visual language, renderer-specific content.

## Recommended next extraction order

The next refactor sequence should follow the surfaces with the highest duplication and the widest renderer reach.

1. shared modal/fullscreen controller
2. shared toolbar/action model
3. shared overlay panel system
4. shared hover/focus/highlight policy
5. shared search/filter/locate surface
6. shared animation scheduler built on top of `AnimationPolicy`
7. deeper viewer-chrome token consolidation

That order keeps the work substrate-first:

- controller semantics first;
- then shared actions;
- then the panel chrome those actions live in;
- then richer interaction and runtime behavior on top.
  - align on the same token names and state classes used by the shared contract.

#### Why this matters

Without this extraction, every control adjustment requires editing at least three places:

- `GraphDpad.vue`
- `MermaidExplorer.#dpad`
- `MermaidExplorer.#modal`

That is exactly the kind of small repeated UI primitive that drifts over time.

The control already exists as a product concept. The code just needs to acknowledge it as one thing.

### Shared camera command contract

This part is also now implemented.

The current package-owned camera surface is:

- `zoomIn()`
- `zoomOut()`
- `pan('up' | 'down' | 'left' | 'right')`
- `centre()`
- `fit()`
- optional `expand()`
- optional `close()`
- optional `getZoomLevel()`
- optional `can(action)`

Implementation points:

- `packages/dagonizer/src/viz/CameraControls.ts`
- `packages/dagonizer/src/viz/index.ts`

Current consumers:

- `docs/.vitepress/theme/components/DagGraph.vue`
- `docs/.vitepress/theme/components/MemoryGraph.vue`
- `packages/dagonizer/src/viz/MermaidExplorer.ts`

This matters because the D-pad machine now dispatches into one stable command vocabulary rather than three local switch statements with duplicated action semantics.

The camera mechanics are still backend-specific:

- Cytoscape uses native camera APIs;
- cosmos shifts point positions in world space;
- Mermaid rewrites an SVG transform camera.

But the command surface above those mechanics is now shared.

### Shared fullscreen / modal shell

This is partially implemented.

Shared shell chrome now exists in:

- `packages/dagonizer/src/viz/ModalShell.css`

And it is consumed by:

- `docs/.vitepress/theme/components/DiagramFrame.vue`
- `packages/dagonizer/src/viz/MermaidExplorer.ts`

What is shared now:

- backdrop treatment;
- blur behavior;
- modal card tokens;
- hint bar tokens;
- shell animation tokens.

What is still separate:

- Mermaid still creates and owns a body-level modal shell directly;
- `DiagramFrame.vue` still owns its own expand/fullscreen lifecycle in Vue;
- there is not yet one package-owned modal controller or one reusable cross-runtime shell machine.

So the shell styling contract is shared, but the lifecycle contract is not fully unified yet.

### Shared legend / filter state model

This is now implemented for the current graph legend surface.

The package-owned legend state surface is:

- `packages/dagonizer/src/viz/LegendMachine.ts`

Current consumers:

- `docs/.vitepress/theme/components/graph/GraphLegend.vue`
- `docs/.vitepress/theme/components/DagGraph.vue`
- `docs/.vitepress/theme/components/MemoryGraph.vue`

What is shared now:

- legend section structure;
- legend entry structure;
- active/inactive toggle state;
- toggle dispatch surface;
- renderer-agnostic legend state lookup via `machine.state()`.

Current behavior split after this extraction:

- DAG uses a static, non-toggle legend;
- MemoryGraph uses a toggleable layer-visibility legend backed by local visibility state.

That means the legend view and legend state contract are shared, while the actual filtering effect still belongs to each visualization.

### Shared selection / inspect contract

This is now implemented at the selection-payload level.

The package-owned inspect selection surface is:

- `packages/dagonizer/src/viz/InspectSelection.ts`

Current shared selection variants:

- `dag-node`
- `iri`
- `literal`

Current consumers:

- `docs/.vitepress/theme/components/DagGraph.vue`
- `docs/.vitepress/theme/components/MemoryGraph.vue`
- `docs/.vitepress/theme/components/TripleInspector.vue`
- `examples/the-archivist/app/ArchivistRunner.vue`

What is shared now:

- one package-owned selection type family;
- one package-owned constructor surface for selection payloads;
- normalized DAG-node selection payloads from the Cytoscape viewer;
- normalized IRI/literal selection payloads from the cosmos memory viewer.

What is still separate:

- DAG inspection UI still routes through the docs-side `ToolExplainPanel` with a plain node-name prop;
- memory inspection UI still routes through `TripleInspector`;
- Mermaid does not yet emit the same inspect payloads through a consumer-facing selection API;
- there is not yet one package-owned inspector panel contract or one shared inspect-state controller.

So the selection payload contract is shared, but the inspector presentation and lifecycle are not unified yet.

### Shared inspector shell

This is now partially implemented at the presentation layer.

The shared inspector shell currently lives in:

- `docs/.vitepress/theme/components/graph/InspectorShell.vue`

Current consumers:

- `docs/.vitepress/theme/components/ToolExplainPanel.vue`
- `docs/.vitepress/theme/components/TripleInspector.vue`

What is shared now:

- absolute overlay positioning;
- card chrome;
- close affordance;
- title row layout;
- scroll container behavior;
- entry animation.

What is still separate:

- the data sources and body content are still different;
- the shell is docs-side, not yet package-owned;
- there is not yet one package-owned inspector controller that routes different inspector bodies from one selection source.

So the inspector presentation shell is shared, but the inspector controller layer is still only partially unified.

### Shared inspector target / controller state

This is now partially implemented at the state-routing layer.

The shared inspector target surface currently lives in:

- `packages/dagonizer/src/viz/InspectorTarget.ts`

Current shared target variants:

- `tool`
- `dag-node`
- `iri`
- `literal`

Current integration:

- `examples/the-archivist/app/ArchivistRunner.vue`

What is shared now:

- one inspector target union instead of independent `selectedTool` and `selectedSelection` refs;
- one close path that clears the active inspector target;
- one state source that routes tool and graph-inspection interactions.

What is still separate:

- inspector bodies still render through separate components;
- Mermaid still does not participate in the same target flow;
- there is not yet one package-owned inspector controller class or machine;
- most consumers outside the Archivist flow do not yet route through the shared target union.

So the inspector target/controller state is shared in the main docs demo flow, but not yet generalized across all consumers.

### Shared viewport status / interaction hints

This is now implemented at the status-payload level.

The shared viewport status surface currently lives in:

- `packages/dagonizer/src/viz/ViewportStatus.ts`

Current integration:

- `packages/dagonizer/src/viz/DpadMachine.ts`
- `packages/dagonizer/src/viz/CameraControls.ts`
- `docs/.vitepress/theme/components/graph/GraphDpad.vue`
- `docs/.vitepress/theme/components/DagGraph.vue`
- `docs/.vitepress/theme/components/MemoryGraph.vue`
- `packages/dagonizer/src/viz/MermaidExplorer.ts`

What is shared now:

- zoom-level status payload;
- inline vs modal mode status;
- shared interaction-hint text payload;
- shared HUD rendering path through the D-pad machine state;
- shared modal hint text sourcing for Mermaid.

What is still separate:

- the modal hint strip is still rendered by Mermaid-specific DOM code;
- there is not yet one package-owned HUD component used outside the docs layer;
- no reduced-motion or accessibility-specific hint policy has been layered onto the shared status contract yet.

So the viewport status payload and hint text contract are shared, but the full hint presentation layer is not completely package-owned.

### Shared animation policy

This is now implemented at the timing-policy level.

The package-owned animation policy surface is:

- `packages/dagonizer/src/viz/AnimationPolicy.ts`

Current consumers:

- `docs/.vitepress/theme/components/viz/AnimatedDagGraph.ts`
- `docs/.vitepress/theme/components/MemoryGraph.vue`

What is shared now:

- node pulse durations;
- node error shake durations;
- edge traversal flash durations;
- camera follow debounce timing;
- camera follow pan duration;
- reset fade duration;
- bounded fit checkpoint schedule;
- fit animation duration;
- layout-settle snapshot timing;
- cosmos simulation decay;
- snap-to-truth transition duration for interaction-driven position updates.

Why this matters:

- the timing decisions are no longer scattered as unrelated magic numbers;
- runtime-truth behavior for fit/settle/snapping is now expressed as one policy;
- Cytoscape and cosmos now derive their animation timing from one source even though the render backends remain different.

What is still separate:

- Mermaid does not yet consume the shared policy for any consumer-facing runtime animation;
- reduced-motion policy is not yet expressed as a first-class shared contract;
- there is not yet one package-owned live-animation controller spanning all viewers;
- the visual meaning of animation states is still concentrated in the docs-side Cytoscape live graph.

So the timing policy is shared, but the entire animation lifecycle is not fully unified yet.

## Recommended consumer-facing modes

The visualizer should explicitly support three modes.

| Mode | Purpose | Best fit |
|---|---|---|
| `static` | docs, README, export, crawlable content | Mermaid or static SVG/HTML |
| `inspect` | application embedding, architecture views, detailed exploration | interactive graph with zoom/pan/select/expand |
| `live` | demos, execution tracing, observability | interactive graph plus runtime state overlays and event animation |

These modes already exist implicitly in the codebase, but they are not currently expressed as one coherent consumer story.

## Runtime animation accuracy

The live mode needs stricter semantics than it has today.

Right now, one of the real risks is that the diagram can keep animating after the underlying DAG work has already completed. That makes the visualizer look impressive, but less truthful.

For a framework consumer, that is the wrong tradeoff.

The animation model should be subordinated to runtime truth.

### Concrete findings from the current code

The current implementation is not inventing activity out of thin air, but it is applying fixed synthetic animation durations that can materially outlast the actual runtime of short steps.

The relevant path is:

- runner/observer emits node and edge events;
- `AnimatedDagGraph` converts them into `DagVizEvent`s;
- `DagVizMachine` routes those events into:
  - `NodeVizMachine`
  - `EdgeVizMachine`
- adapters inside `AnimatedDagGraph` run the actual Cytoscape animation calls.

The main problems are concentrated in a small set of places.

#### Fixed node pulse durations

In `docs/.vitepress/theme/components/viz/AnimatedDagGraph.ts`, the node adapter pulse uses fixed chained Cytoscape animations:

- animate in for `280ms`
- animate out for `360ms`

That means a node start event creates roughly `640ms` of visual activity even when the underlying node may have completed much faster.

This is the clearest reason the viewer can visually outlast the run.

#### Fixed edge flash durations

In the same file, the edge adapter flash uses:

- `220ms` flash in
- `320ms` settle out

So an edge traversal carries around `540ms` of visual effect regardless of the actual execution timeline.

Again, this is reasonable for presentation, but weak for runtime-truth mode.

#### Camera follow keeps moving after execution has advanced

`AnimatedDagGraph.#followActiveSet()` uses:

- `cy.animate({ center: { eles: nodes } }, { duration: 240 })`

That means the graph can still be visibly panning after the active node set has already changed or finished.

This contributes to the perception that the DAG is still running even when the engine has already moved on.

#### Reset intentionally waits before clearing state

`AnimatedDagGraph.reset()` adds a reset class and then waits about `280ms` before clearing visual state.

This is not the main execution-timing problem, but it confirms the current visual layer is optimized for visual continuity rather than strict temporal truth.

#### Node state machine carries no timestamps

`NodeVizMachine` only knows:

- `pending`
- `active`
- `completed`
- `errored`

It does not store:

- when the node actually started;
- when it ended;
- how long it ran;
- when the visual state should settle.

Because of that, it cannot distinguish a node that ran for `12ms` from one that ran for `2.4s`.

Both receive the same visual choreography.

#### Edge state machine also carries no timestamps

`EdgeVizMachine` only models:

- `idle`
- `traversed`

There is no timing model for when traversal occurred or how long the visual signal should persist.

So edge animation is also purely synthetic.

#### Runner integration is inconsistent across demos

The demos do not drive the graph in one unified way.

Archivist and Dispatcher push graph events directly as observer callbacks fire.

Cartographer buffers node/edge events and flushes them on `requestAnimationFrame` to survive very high event volume.

That batching is reasonable for throughput, but it means the visualizer does not have one consistent timing contract across consumers today.

#### The event contract is too coarse

`DagVizEvent` currently carries semantic events such as:

- `NODE_START`
- `NODE_END`
- `NODE_ERROR`
- `EDGE_TRAVERSE`

But not:

- `at` timestamps;
- run-level completion timestamps;
- duration metadata;
- explicit visual-settle policy.

Without timestamps in the event contract, the animation layer cannot be meaningfully runtime-accurate.

### The core rule

The viewer should never materially outlast the execution it is representing unless it is clearly rendering post-run summary state.

In other words:

- execution-state animation should be event-driven;
- transition duration should be bounded by real runtime timestamps;
- completion should settle quickly once the run is actually done;
- the viewer should distinguish between:
  - active execution;
  - brief state transition;
  - final settled summary state.

### What is likely happening today

The docs/demo animation layer appears to emphasize visual continuity:

- active nodes remain visually “hot” for a while;
- edge traversal may animate as if the route is still in flight;
- camera follow and staged updates can continue after the engine has already advanced or finished.

That is fine for a product demo, but weak for a consumer-facing observability surface.

### What should change

#### 1. Drive animation from runtime events, not independent visual timing

The viewer should consume an explicit event stream or execution snapshot model such as:

```ts
type DagVizRuntimeEvent =
  | { type: 'node:start'; id: string; at: number }
  | { type: 'node:end'; id: string; at: number; outcome: 'completed' | 'failed' | 'cancelled' }
  | { type: 'edge:traversed'; source: string; target: string; route: string; at: number }
  | { type: 'run:start'; at: number }
  | { type: 'run:end'; at: number; outcome: 'completed' | 'failed' | 'cancelled' };
```

Visual state should derive from this stream, not from standalone animation timers pretending work is still happening.

#### 2. Separate state duration from effect duration

There are two different things:

- how long the node was actually active;
- how long a visual transition effect should remain visible.

The package should model both explicitly.

Example:

```ts
type DagViewerAnimationOptions = {
  highlightFadeMs?: number;
  edgePulseMs?: number;
  completionSettleMs?: number;
  maxSyntheticLagMs?: number;
}
```

The important constraint is that these values should decorate real runtime, not replace it.

#### 3. Cap synthetic lag tightly

If a node executes in 20ms, it is acceptable to make that perceptible to the eye.

It is not acceptable to make it look like a 20ms step ran for 800ms unless the user explicitly chose presentation mode.

The viewer should enforce a bounded synthetic lag policy, for example:

- no active-state hold beyond a small configured ceiling;
- no edge pulse that continues long after the target node has already completed;
- no post-completion camera choreography that implies work is still ongoing.

#### 4. Make the active state mostly runtime-owned

The node should remain visually active because the node is actually active, not because a pulse animation is still playing.

The pulse should be treated as a short visual accent layered on top of active state, not as the active-state duration model.

#### 5. Make camera follow cancellable and execution-bound

Camera motion should be bounded by active runtime state.

If the active set becomes empty or the run ends, any pending follow animation should stop or settle immediately.

The viewer should not still be drifting because a previously-scheduled center animation is finishing.

### Recommended animation modes

The viewer should expose explicit animation policies instead of one blended behavior.

| Mode | Purpose | Timing policy |
|---|---|---|
| `accurate` | observability, debugging, serious inspection | durations track real runtime; only minimal perceptibility smoothing |
| `balanced` | default app/demo mode | small synthetic smoothing, but bounded and truthful |
| `presentation` | marketing/demo theater | slower transitions allowed, but clearly opt-in |

Framework consumers should default to `accurate` or `balanced`, not `presentation`.

### Recommended timing rules

#### Node activity

- node enters active state on `node:start`
- node exits active state on `node:end`
- active highlight may fade out briefly after end, but only within a small configured budget

#### Edge traversal

- edge traversal starts when the engine reports the route traversal
- pulse duration should be short and should never imply the edge is still in flight after downstream completion is already known

#### Run completion

- once `run:end` arrives, the viewer should settle rapidly
- active-state animation should collapse into final outcome state
- camera follow should stop immediately or within a tiny settle window

#### Very fast runs

When real execution is too fast to perceive, the viewer may stretch visibility slightly for legibility, but should do so consistently and with a hard cap.

Good policy:

- perceptibility floor for micro-events
- hard ceiling for synthetic extension
- separate policy for presentation mode if desired

### Recommended data model

The viewer should track both real timestamps and rendered-state timestamps.

Example:

```ts
type NodeRuntimeState = {
  startedAt?: number;
  endedAt?: number;
  outcome?: 'completed' | 'failed' | 'cancelled';
};

type NodeVisualState = {
  visibleState: 'idle' | 'active' | 'completed' | 'failed' | 'cancelled';
  enteredAt: number;
  settlesAt?: number;
};
```

That makes it possible to reason clearly about:

- runtime truth;
- temporary visual smoothing;
- final settled state.

### Camera behavior should also be runtime-aware

Camera follow is part of animation fidelity.

If the camera keeps drifting, panning, or fitting after execution is complete, users perceive the run as still “doing something.”

Recommended rules:

- camera follow should respond only to active runtime state;
- on run completion, follow mode stops;
- any final fit/center should be explicit and fast;
- presentation-only camera choreography should be opt-in.

### Consumer-facing API shape

This should be configurable directly:

```ts
const viewer = new DagViewer(container, {
  dag,
  initialMode: 'live',
  animation: {
    mode: 'accurate',
    highlightFadeMs: 120,
    edgePulseMs: 140,
    completionSettleMs: 80,
    maxSyntheticLagMs: 160,
  },
});
```

And for presentation/demo use:

```ts
const viewer = new DagViewer(container, {
  dag,
  initialMode: 'live',
  animation: {
    mode: 'presentation',
    highlightFadeMs: 400,
    edgePulseMs: 500,
    completionSettleMs: 250,
  },
});
```

That keeps the slower theatrical behavior available without making it the truth model for ordinary users.

### Recommendation

The package should explicitly treat runtime animation as an observability concern, not just a visual-design concern.

That means:

1. runtime events are the source of truth;
2. animation is a bounded overlay on those events;
3. node and edge state machines carry timing context, not just symbolic state;
4. completion settles quickly;
5. slower “demo theater” timing is opt-in;
6. animation policy belongs in the public config contract.

## What “parameterized” should mean

The package should expose parameters that matter to Dagonizer users, not generic graph-theory knobs for their own sake.

That does not mean hiding Mermaid or Cytoscape. It means:

- expose Dagonizer-first configuration at the top level;
- allow full pass-through backend configuration in dedicated namespaces;
- merge both through one documented schema.

### Structural parameters

- orientation;
- id mode;
- embedded-DAG expansion strategy:
  - collapsed;
  - selected names expanded;
  - all expanded;
  - depth-limited;
- terminal-node visibility;
- scatter/gather detail level.

### Visual parameters

- compact vs detailed labels;
- node subtitle strategy;
- container-role palette;
- status palette;
- reservoir styling;
- overview mode vs inspect mode density.

### Interaction parameters

- selectable nodes;
- click behavior;
- keyboard navigation;
- fit behavior;
- fullscreen support;
- minimap policy;
- tooltip policy;
- route highlighting;
- camera-follow policy for live mode.

### Animation parameters

- animation mode (`accurate`, `balanced`, `presentation`);
- node highlight fade duration;
- edge pulse duration;
- completion settle duration;
- maximum synthetic lag budget;
- camera-follow settle policy.

### Annotation parameters

- badges;
- descriptions;
- runtime metrics;
- provenance markers;
- checkpoint markers;
- user-defined tags.

These are the parameters actual framework consumers will care about.

### Backend pass-through parameters

In addition to Dagonizer-first parameters, the viewer should expose explicit pass-through blocks such as:

- `mermaid`
- `cytoscape`

Those blocks should accept the native backend options as directly as possible.

That gives consumers two levels of control:

1. Dagonizer-friendly high-level behavior;
2. raw backend escape hatches when they need exact Cytoscape or Mermaid behavior.

## Concrete productization path

### Phase A: lift docs-only behavior into the package

Promote the most useful parts of `AnimatedDagGraph` into package-owned viewer code:

- embedded-DAG expand/collapse;
- readable initial fit;
- zoom/pan/fit controls;
- node click and selection hooks;
- variant/status styling seams.

This removes the need for downstream users to depend on docs code to get the good experience.

### Phase B: define a view-model contract

Create a normalized DAG visualization model that can drive both Mermaid and Cytoscape outputs.

That model should capture:

- placements;
- route edges;
- placement metadata;
- container/group semantics;
- annotation slots;
- viewer-specific display metadata.

This reduces drift between static and interactive outputs.

At the same time, define a schema-owned configuration model that resolves:

- Dagonizer defaults;
- Dagonizer high-level viewer options;
- Mermaid pass-through options;
- Cytoscape pass-through options;
- annotation and theme overlays.

The normalized graph model and the normalized config model should evolve together.

### Phase C: ship one high-level viewer

Expose:

- core package class: `DagViewer`;
- optional framework adapter: for example a thin Vue wrapper such as `<DagViewer />`.

The adapter should stay thin.

The behavior should live in the package, not in docs-only wrappers.

### Phase D: preserve static export as first-class

Do not demote Mermaid export.

Downstream users still need:

- README diagrams;
- architecture docs;
- static site content;
- exportable topology views.

The modernization should improve consistency between the static and interactive views, not replace one with the other.

### Phase E: move live animation onto a runtime-truth model

The docs/demo animation layer should be refactored so live mode is driven by runtime timestamps and bounded visual smoothing, not detached visual pacing.

This phase should produce:

- a public runtime-event input contract;
- a public animation policy contract;
- an accurate default mode;
- an opt-in presentation mode for slower demo storytelling.

## Recommended API shape

Target experience:

```ts
import {
  MermaidRenderer,
  DagViewer,
  type DagViewerTheme,
} from '@studnicky/dagonizer/viz';

const mermaid = MermaidRenderer.render(dag, {
  ...dagonizerMermaidDefaults,
  orientation: 'LR',
  theme: {
    ...dagonizerMermaidDefaults.theme,
    ...myTheme.mermaid,
  },
});

const viewer = new DagViewer(container, {
  dag,
  embeddedDAGs,
  theme: myTheme,
  initialMode: 'inspect',
  expand: { strategy: 'selected', names: ['payments-subdag'] },
  annotations: {
    nodeStatus,
    nodeBadges,
  },
  animation: {
    mode: 'accurate',
    highlightFadeMs: 120,
    edgePulseMs: 140,
    completionSettleMs: 80,
    maxSyntheticLagMs: 160,
  },
  interactions: {
    selectable: true,
    fullscreen: true,
  },
  cytoscape: {
    minZoom: 0.05,
    maxZoom: 6,
    wheelSensitivity: 0.15,
  },
});

await viewer.mount();
```

That is a stronger consumer story than:

- “here is a Mermaid string”; or
- “here are raw Cytoscape elements; build the rest yourself”.

## Recommendation

The modernization plan for Dagonizer visualization should be:

1. keep `MermaidRenderer` as the static/export layer;
2. keep `CytoscapeRenderer` as the structural graph layer;
3. keep `CytoscapeGraph` as the low-level extension surface;
4. extract the best docs-side interaction model into a package-level `DagViewer`;
5. add stable theme, annotation, interaction, and schema-merged config contracts for downstream users;
6. support full Mermaid and Cytoscape pass-through under dedicated config namespaces;
7. ship thin framework adapters instead of hiding the good viewer in docs code.

That would make the visualizer materially more useful to people who build on Dagonizer, while preserving the Dagonizer-specific semantics that make it valuable in the first place.

## Completion audit against the pasted objective

The pasted objective named eight shared visualizer surfaces.

Current-state audit:

1. Zoom HUD / viewport readout
   - implemented through `packages/dagonizer/src/viz/ViewportStatus.ts`
   - consumed by:
     - `docs/.vitepress/theme/components/DagGraph.vue`
     - `docs/.vitepress/theme/components/MemoryGraph.vue`
     - `packages/dagonizer/src/viz/MermaidExplorer.ts`

2. Fullscreen / modal shell
   - shared shell styling implemented through:
     - `packages/dagonizer/src/viz/ModalShell.css`
   - shared expanded-modal lifecycle implemented through:
     - `packages/dagonizer/src/viz/ModalController.ts`
   - integrated into:
     - `docs/.vitepress/theme/components/DiagramFrame.vue`
     - `packages/dagonizer/src/viz/MermaidExplorer.ts`

3. Legend / layer controls
   - shared legend/filter state implemented through:
     - `packages/dagonizer/src/viz/LegendMachine.ts`
   - shared legend renderer consumed by:
     - `docs/.vitepress/theme/components/DagGraph.vue`
     - `docs/.vitepress/theme/components/MemoryGraph.vue`

4. Camera command vocabulary
   - shared camera command contract implemented through:
     - `packages/dagonizer/src/viz/CameraControls.ts`
   - consumed by:
     - `docs/.vitepress/theme/components/DagGraph.vue`
     - `docs/.vitepress/theme/components/MemoryGraph.vue`
     - `packages/dagonizer/src/viz/MermaidExplorer.ts`

5. Interaction hints / affordance overlays
   - shared hint text contract implemented through:
     - `packages/dagonizer/src/viz/ViewportStatus.ts`
   - shared overlay states implemented for docs-hosted graph views through:
     - `packages/dagonizer/src/viz/ViewerOverlay.css`
     - `docs/.vitepress/theme/components/graph/ViewerOverlay.vue`

6. Selection / inspect state
   - normalized inspect payloads implemented through:
     - `packages/dagonizer/src/viz/InspectSelection.ts`
     - `packages/dagonizer/src/viz/InspectorTarget.ts`
   - shared selected-target controller implemented through:
     - `packages/dagonizer/src/viz/SelectionController.ts`
   - visible selected-state parity implemented across:
     - `docs/.vitepress/theme/components/viz/AnimatedDagGraph.ts`
     - `docs/.vitepress/theme/components/MemoryGraph.vue`
     - `docs/.vitepress/theme/components/TraceFeed.vue`
     - `packages/dagonizer/src/viz/MermaidExplorer.ts`

7. Theme tokens for overlays
   - shared token families now exist through:
     - `packages/dagonizer/src/viz/Dpad.css`
     - `packages/dagonizer/src/viz/ModalShell.css`
     - `packages/dagonizer/src/viz/ViewerActions.css`
     - `packages/dagonizer/src/viz/ViewerOverlay.css`
     - `packages/dagonizer/src/viz/explorer.css`

8. Animation policy
   - shared baseline animation policy implemented through:
     - `packages/dagonizer/src/viz/AnimationPolicy.ts`
   - consumed by:
     - `docs/.vitepress/theme/components/viz/AnimatedDagGraph.ts`
     - `docs/.vitepress/theme/components/MemoryGraph.vue`

Validation evidence:

- `pnpm --filter @studnicky/dagonizer run typecheck`
- `pnpm run typecheck:docs`
- `pnpm --filter @studnicky/the-archivist-example run typecheck`
- `git diff --check` on touched files

Override/config hardening completed in the current state:

- `ViewportStatus.ts` now exposes an explicit options contract with:
  - `hint`
  - `canPan`
  - `canFit`
  - `formatZoom`
  - shared `zoomText`
- `DpadMachine.ts` and `GraphDpad.vue` now consume shared zoom text rather than formatting zoom ad hoc in the Vue host.
- `ViewerActions.ts` now exposes a broader shared action vocabulary and metadata surface, including:
  - `ariaLabel`
  - `shortcut`
  - additional shared action ids beyond the original header/overlay trio
- `ViewerActions.css`, `ViewerOverlay.css`, `Dpad.css`, and `ModalShell.css` document their CSS custom-property override surfaces explicitly.
- `explorer.css` now exposes formal Mermaid selected-state override tokens:
  - `--dag-explorer-selected-stroke`
  - `--dag-explorer-selected-width`
  - `--dag-explorer-selected-glow`

Conclusion:

The named shared-surface updates from the pasted objective are implemented in the current codebase.
