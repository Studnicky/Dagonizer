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
