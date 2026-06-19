---
"@studnicky/dagonizer-examples": patch
---

Convert the residual guide twoslash blocks to real-source transclusions. The
custom checkpoint store, custom adapter, pattern node, and serverless handler
guides now pull from runnable example modules — `custom-checkpoint-store.ts`,
`custom-adapter.ts`, `pattern-node.ts`, `serverless-handler.ts` — that
type-check under the examples tsconfig and run offline against real in-process
backings (Map-backed store, echo adapter, in-memory queue channel). The
distribution hand-off guide transcludes the existing `11-handoff.ts` channel
implementation. The persistence contract block remains a reference-style
twoslash for the `CheckpointStoreInterface` surface.
