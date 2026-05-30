---
'@noocodex/dagonizer': minor
---

Audit-driven cleanup (performance + V8 shape + canonical naming):

- `Scheduler.current()` returns the active `SchedulerProvider` directly instead of allocating a new wrapper on every call. `SchedulerProvider` structurally satisfies `SchedulerHandle`, so the public return type is unchanged; this removes a per-node / per-scatter-clone allocation on the hot path and is always current.
- `ToolError.status` is now `number | null` and always initialised (`null` = no HTTP status) instead of an optional conditionally-assigned field, so every `ToolError` instance shares one stable V8 hidden class.
- Removed the forbidden `SearchTool` alias re-export from `@noocodex/dagonizer/patterns` (it aliased the canonical `Tool` type). Tool-shaped patterns reference `Tool` from `@noocodex/dagonizer/tool` directly. Consumers importing `SearchTool` from `./patterns` should import `Tool` from `./tool`.
