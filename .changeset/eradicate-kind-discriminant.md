---
"@studnicky/dagonizer": minor
---

Rename every discriminated-union tag from `kind` to `variant` across the whole monorepo (all packages version in lockstep). The discriminant field on every wire-shape entity and runtime union is now `variant`: `DAGLifecycleState` (`pending`/`running`/`completed`/`failed`/`cancelled`/`timed_out`), `LlmOutputSchema` (`none`/`schema`), the chat-response message union (`text`/`tools`/`mixed`), `ScatterProgress` (`map`/`field`/`plain`), the executor `BridgeMessage` union (`init`/`execute`/`abort`/`shutdown`/`ready`/`result`/`intermediate`/`instrumentation`/`error`), and the viz node descriptors. JSON Schema `$id`s are unchanged but their `kind` property is now `variant`, so persisted snapshots and on-the-wire messages from prior versions must migrate the field name. Consumers reading `state.lifecycle.kind`, `response.message.kind`, `outputSchema.kind`, or any bridge/scatter discriminant update to `.variant`.

Example demos now gate on publish. `the-archivist`, `the-cartographer`, and the numbered `dagonizer-examples` each run a `node --test` suite (Node 24 native type-stripping — no tsx), wired into `test:examples` and the `ci`/`release` pipeline so a crashing or regressed demo can no longer reach a published release. This also resolves the `readable-stream`/`n3` loader crash that only surfaced under tsx.
