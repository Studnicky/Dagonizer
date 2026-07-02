---
'@studnicky/dagonizer': patch
---

`DAGError` gains three static helpers consolidating catch-clause error handling duplicated across the codebase: `DAGError.coerce(cause)` normalises an unknown catch value into an `Error`, wrapping non-`Error` causes in a `DAGError` (code `EXECUTION_ERROR`); `DAGError.messageOf(error)` extracts a message string from an unknown catch value; `DAGError.isTimeout(reason)` reports whether a rejection reason is an `Error` named `TimeoutError`. `src/patterns/agent/*.ts` (`BuildChatRequestNode`, `AppendAssistantNode`, `CollectToolResultsNode`, `DecodeTextToolCallsNode`, `CallModelNode`, `NormalizeResponseNode`, `BuildToolWorksetsNode`, `NormalizeToolCallsNode`), `src/checkpoint/Checkpoint.ts`, `src/dag/DAGDocument.ts`, and `src/container/DagHost.ts` now call `DAGError.coerce`/`DAGError.messageOf` instead of their own inline `instanceof Error` ternaries. Behavior is unchanged.
