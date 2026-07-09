---
title: 'Example 33: Plugin-Defined DAGs'
description: 'The Cartographer packages its source-normalization child DAGs as a plugin, registers that plugin once, and embeds the exported DAG references from the ingest DAG.'
seeAlso:
  - text: 'Guide: Plugins'
    link: '../guide/plugins'
    description: 'defineDagonizerPlugin, PluginLoader, and registry-wide plugin loading'
  - text: 'Guide: DAGBuilder'
    link: '../guide/builder'
    description: 'the embed() builder and embedded DAG state mapping'
  - text: 'Example 05: EmbeddedDAGNode composition'
    link: './05-embedded-dags'
    description: 'same child/parent shape without plugin packaging'
---

<script setup lang="ts">
import { ingestSourceDAG, normalizeCsvDAG, normalizeJsonDAG } from '../.vitepress/theme/exampleDags.ts';
</script>

# Example 33: Plugin-Defined DAGs

## What It Is

Plugin-Defined DAGs show the unified interface for plugins and embedded flows. The Cartographer packages source-normalization child DAGs as a plugin, registers that plugin once, and embeds the exported DAG references from the ingest DAG.

There is no special plugin placement type. Plugin DAGs enter the same registry as local DAGs, and parent graphs embed them with the same `EmbeddedDAGNode` contract.

## How It Works

`defineDagonizerPlugin` packages a plugin ID, nodes, DAGs, and context declarations. `registerPlugin(...)` scopes those registry entries by plugin identity, then exposes the plugin DAGs through the same DAG registry used by `registerBundle(...)`. The parent DAG embeds plugin-provided DAG IRIs exactly like locally-authored child DAGs.

This is the dev-ex target from the plugin work: a reusable part ships its own nodes and DAG documents, while the host assembles the final application through canonical JSON-LD or builder output.

## Diagrams, Examples, and Outputs

### DAG registration and diagram

The [Cartographer](./the-cartographer) packages its format-normalization child DAGs as `normalizeSourcesPlugin`. The browser runner registers the plugin, then registers `ingestSourceDAG`, whose embedded placements reference the plugin-provided DAG IRIs (`urn:noocodec:dag:normalize-csv`, `urn:noocodec:dag:normalize-json`, `urn:noocodec:dag:normalize-ndjson`, `urn:noocodec:dag:normalize-yaml`).

<DagJsonMermaid :dag="ingestSourceDAG" title="Cartographer ingest DAG embedding plugin DAGs" aria-label="Cartographer ingest JSON-LD DAG beside Mermaid generated from it." />

<DagJsonMermaid :dag="normalizeCsvDAG" title="plugin-provided normalize-csv DAG" aria-label="Plugin-provided CSV normalization JSON-LD DAG beside Mermaid generated from it." />

<DagJsonMermaid :dag="normalizeJsonDAG" title="plugin-provided normalize-json DAG" aria-label="Plugin-provided JSON normalization JSON-LD DAG beside Mermaid generated from it." />

The important point is interface unification: plugin DAGs and ordinary embedded DAGs both enter the same registry and both execute through `EmbeddedDAGNode`.

### Run

```bash
npm run docs:dev
```

Open [The Cartographer](./the-cartographer). The browser runner registers `normalizeSourcesPlugin` alongside the Cartographer DAG bundle before execution.

## What It Lets You Do

Plugin-defined DAGs let applications consume reusable flows as installable parts while preserving the same embedded-DAG interface used inside the application. Use this when a team wants to package nodes and child DAGs once, register them by plugin ID, and embed the exported DAG IRIs from higher-level flows.

The result is composability without a second assembly language. Local DAGs, plugin DAGs, literal `dag` references, and dynamic `DagReference` bodies all resolve through the same registry.

## Code Samples

The plugin packages real Cartographer normalization nodes and child DAGs:

<<< @/../examples/the-cartographer/plugins/NormalizeSourcesPlugin.ts#cartographer-normalize-plugin

The ingest DAG embeds the plugin-provided child DAG IRIs through the normal builder surface:

<<< @/../examples/the-cartographer/embedded-dags/IngestSourceDAG.ts

The browser demo registers the plugin before registering the ingest and top-level bundles:

<<< @/../docs/.vitepress/theme/components/CartographerRunner.vue#cartographer-browser-plugin-registration

## Details for Nerds

- **One registry seam.** `registerPlugin(normalizeSourcesPlugin)` adds nodes and DAGs through the same registry used by `registerBundle()`.
- **No plugin-specific placement.** `IngestSourceDAG` embeds `urn:noocodec:dag:normalize-csv` and `urn:noocodec:dag:normalize-json` exactly like any other child DAG.
- **Scoped package exports.** Applications depend on plugin exports and DAG IRIs, not on plugin internals.
- **Runnable browser assembly.** The Cartographer HMR page registers the plugin during each run, so docs and runtime use the same assembly pattern.

## Related Concepts

- [Guide: Plugins](../guide/plugins) - defineDagonizerPlugin, PluginLoader, and registry-wide plugin loading
- [Guide: DAGBuilder](../guide/builder) - the embed() builder and embedded DAG state mapping
- [Example 05: EmbeddedDAGNode composition](./05-embedded-dags) - same child/parent shape without plugin packaging
