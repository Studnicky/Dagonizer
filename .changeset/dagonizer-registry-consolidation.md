---
'@studnicky/dagonizer': patch
---

`GatherStrategies` and `OutcomeReducers` now extend a shared `Registry<TEntry>` base (`src/core/Registry.ts`, re-exported from `@studnicky/dagonizer/core`) instead of each hand-rolling an identical named-strategy registry. `Registry` captures `register`/`replace`/`unregister`/`reset`/`resolve`/`list` and the duplicate-registration guard once, parameterised over the entry type and the built-in set plus label strings each subclass supplies for its error messages. `GatherStrategies` and `OutcomeReducers` are now singleton instances of a private `Registry` subclass rather than static classes with a private constructor; their public call sites, method signatures, and error messages are unchanged.
