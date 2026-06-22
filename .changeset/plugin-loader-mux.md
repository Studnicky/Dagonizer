---
"@studnicky/dagonizer": minor
---

Plugin loader: PluginInterface (register(dispatcher)) + Dagonizer.registerPlugin(plugin) +
PluginDiscovery.referencedDagNames(dag) / walk(dag, registry) via new ./plugin subpath.

Multi-observer mux: DagonizerOptionsType gains optional observers array of DispatcherObserverType
callbacks muxed into all lifecycle hooks. Provides an alternative to subclassing for
per-turn-rebuilt dispatchers.
