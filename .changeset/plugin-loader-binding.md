---
"@studnicky/dagonizer": minor
---
PluginLoader: type-safe dynamic plugin import binding. PluginLoader.load(specifier)
dynamically imports a module and validates its default export as a PluginInterface via
a structural type-guard predicate — no casts at the call site. PluginLoader.validate(mod)
and PluginLoader.isPlugin(value) are also exported for use with already-imported modules.
PluginDiscovery.loadAll(dag, registry, dispatcher, resolveSpecifier) composes the walker
with the loader to register all transitively-referenced plugins in one call.
