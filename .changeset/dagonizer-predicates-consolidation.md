---
'@studnicky/dagonizer': patch
---

`ContextResolver.isContext`, `ToolInvocationState.isArgumentRecord`, and `NodeStateBase.restoreFields`'s `'array'`/`'object'` field restorers now call `@studnicky/predicates`'s `Predicates.matchesType` directly instead of a hand-rolled `typeof value === 'object' && value !== null && !Array.isArray(value)` check. Behavior is unchanged.

`package.json` gains `@studnicky/predicates` as a dependency.
