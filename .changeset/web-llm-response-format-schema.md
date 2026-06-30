---
"@studnicky/dagonizer-adapter-web-llm": patch
---

Fix `BindingError` thrown by `GrammarCompiler.CompileJSONSchema` on every structured-output call. `WebLlmAdapter.performChat()` now computes a `schema` string (JSON-serialised tool-plan schema or output schema) and passes it natively via `response_format: { type: 'json_object', schema }` so the grammar compiler receives a valid string instead of an undefined value. Plain text requests continue to receive `{ type: 'text' }` with no schema field. The system message still carries the schema description as belt-and-suspenders reinforcement.
