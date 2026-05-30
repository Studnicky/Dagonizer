---
'@noocodex/dagonizer': minor
'@noocodex/dagonizer-tool-googlebooks': minor
'@noocodex/dagonizer-tool-wikipedia': minor
---

Audit-driven cleanup across the monorepo (performance, V8 shape, consistency) — every confirmed and advisory finding addressed.

Core (`@noocodex/dagonizer`):
- perf: `Scheduler.current()` returns the active provider directly (no per-call wrapper allocation on the node/scatter hot path); `SchedulerProvider` structurally satisfies `SchedulerHandle`, so the public return type is unchanged.
- perf: gather strategies (`map`/`append`/`partition`) no longer re-sort `execution.records` — records are now documented as an invariant to be source-index ordered (the scatter loop builds them so on every path including resume), eliminating a redundant `.slice().sort()` per gather. `executeScatter` builds the reducer input by iterating the outputs map directly (no intermediate spread).
- fix(v8-shape): `ToolError.status` is `number | null`, always initialised, so every instance shares one hidden class.
- consistency: wire-format helpers in `OpenAiCompatibleAdapter` are private methods (no freestanding `toX`/`parseX` functions); removed the forbidden `SearchTool` alias from `./patterns` (use canonical `Tool` from `./tool`).

Plugin packages: provider adapters' wire-format/error helpers consolidated onto their adapter classes; `StubAdapter` constructor arg `opts`→`options`; redundant `public` modifier dropped; `OpenLibrarySearchTool` populates `notes` provenance consistently with the other tools.

Tool packages (`-tool-googlebooks`, `-tool-wikipedia`): now re-export the `@noocodex/dagonizer-book-entities` types (`Book`, `Candidate`, `Money`, `CanonicalId`) they expose in their public surface, matching `-tool-openlibrary`.
