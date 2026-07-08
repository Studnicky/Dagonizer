---
title: 'Example 14: Gather Strategies'
description: "Cartographer's real gather strategies: streaming insight folds, scatter-local candidate collection, and a first-class geo-weighted-fusion gather barrier."
seeAlso:
  - text: 'Example 04: Scatter Scout'
    link: './04-scatter'
    description: 'scatter mechanics: source, body, gather, reduce'
  - text: 'Example 04B: Scatter Collect'
    link: './04b-scatter-collect'
    description: 'map gather: generate-and-select pattern'
  - text: 'Example 15: Incremental gather'
    link: './15-incremental-gather'
    description: 'incremental vs batch gather timing'
  - text: 'Reference: Core, GatherStrategies'
    link: '../reference/core'
---

<script setup lang="ts">
import { cartographerDAG } from '../../examples/the-cartographer/dag.ts';
import { GeoSourceResolveDAG } from '../../examples/the-cartographer/embedded-dags/GeoSourceResolveDAG.ts';
import { GeoResolvers } from '../../examples/the-cartographer/services/GeoResolvers.ts';

const services = GeoResolvers.recorded();
const geoSourceResolveDAG = GeoSourceResolveDAG.build(
  services.ipGeolocator,
  services.addressGeocoder,
).dags.find((dag) => dag.name === 'geo-source-resolve');
</script>

# Example 14: Gather Strategies

## What It Is

Gather Strategies decide how producer results become parent state. The Cartographer uses them as application logic: one scatter-local gather folds stream insights into bounded aggregates, one map gather collects geo candidates, and one first-class `GatherNode` fuses those candidates into a selected location.

This page is about merge policy, not fan-out. Scatter runs clone work; gather decides what the parent sees after each clone, after the whole scatter, or at an explicit graph-visible barrier.

## How It Works

A scatter produces clone outcomes. A scatter-local gather strategy reads each completed clone's state through the dispatcher accessor and writes the parent fields named in the placement's `gather` config. The reducer is a separate decision: gather mutates parent state, then the reducer chooses the scatter output route (`all-success`, `partial`, `all-error`, or `empty`).

A first-class `GatherNode` is a normal DAG placement. Producers route into it by placement name; the gather node names the producer labels it waits for, applies its strategy, then routes on `success`, `error`, or `empty`. In the Cartographer geo resolver, `resolve-signals` maps every clone's `candidate` into `state.geoCandidates`; the `geo-weighted-fusion` gather node is the explicit barrier that turns those candidates into `state.resolvedGeo` and `state.geoContext`.

Keeping gather separate from outcome reduction matters for application code. A scatter can fold partial data into state and still route `partial`, `all-error`, or `empty` based on the outcome set.

## Diagrams, Examples, and Outputs

### DAG registration and diagram

The in-browser [Cartographer](./the-cartographer) owns the real gather examples. Its top-level `process-stream` scatter folds enriched records into bounded insight state with `insights-fold`; its `geo-source-resolve` sub-DAG makes fusion graph-visible with a first-class `geo-weighted-fusion` gather node.

<DagJsonMermaid :dag="cartographerDAG" title="Cartographer insights-fold gather DAG" aria-label="Cartographer JSON-LD DAG beside Mermaid generated from it." />

<DagJsonMermaid v-if="geoSourceResolveDAG" :dag="geoSourceResolveDAG" title="geo-source-resolve weighted gather DAG" aria-label="Geo-source-resolve JSON-LD DAG beside Mermaid generated from it." />

Both custom strategies are registered and exercised by the Cartographer runnable. `insights-fold` keeps the browser demo bounded for large streams; `geo-weighted-fusion` merges parallel geo resolver candidates into one selected resolution. The generic `map` strategy does the small mechanical handoff between the scatter and the explicit gather barrier.

### Run

```bash
npm run docs:dev
```

## What It Lets You Do

Gather strategies let producer placements decide how results become parent state. They fit cases where worker bodies stay focused on one item while the parent DAG owns the merge policy: fold every result into a bounded aggregate, pick the best candidate, discard fire-and-forget output, or run a domain-specific merge at an explicit fan-in barrier.

## Code Samples

Read the snippets with the diagrams nearby so the TypeScript behavior, JSON-LD graph shape, and runtime output line up as one contract.

<<< @/../examples/the-cartographer/dag.ts#cartographer-dag

<<< @/../examples/the-cartographer/embedded-dags/GeoSourceResolveDAG.ts

<<< @/../examples/the-cartographer/core/GeoWeightedFusionGather.ts

## Details for Nerds

- **Gather is placement policy.** Scatter placements and first-class gather nodes declare `gather` by strategy name; worker/body nodes do not own parent merge behavior.
- **Streaming fold.** `insights-fold` updates parent aggregates as stream clones complete.
- **Explicit fusion barrier.** `geo-source-resolve` maps raw scatter candidates first, then routes into a `GatherNode` named `geo-weighted-fusion`.
- **Weighted selection.** `geo-weighted-fusion` folds multiple resolver candidates into one canonical geo result.
- **Same engine surface.** Both strategies are just names in JSON-LD and registry entries in the runnable demo.

## Related Concepts

- [Example 04: Scatter Scout](./04-scatter) - scatter mechanics: source, body, gather, reduce
- [Example 04B: Scatter Collect](./04b-scatter-collect) - map gather: generate-and-select pattern
- [Example 15: Incremental gather](./15-incremental-gather) - incremental vs batch gather timing
- [Reference: Core, GatherStrategies](../reference/core)
