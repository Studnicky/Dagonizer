# @noocodex/dagonizer-patterns-graph

## 1.0.0

### Minor Changes

- 20ab46d: Add `RdfStore` — an in-memory RDF triple store that implements both the `Store` key-value contract (via reification under `urn:dagonizer:store:`) and the `TripleStore` quad contract from `@noocodex/dagonizer/patterns`. Backing is an internal `Quad[]` with no external dependencies. Store-side `snapshot()` captures only the reified key-value subjects; `restore()` clears all quads (including user-asserted triples) before reseeding — documented trade-off, override `performRestoreEntries` to preserve user quads.

### Patch Changes

- Updated dependencies [7dc830c]
- Updated dependencies [540876f]
- Updated dependencies [20ab46d]
  - @noocodex/dagonizer@0.11.0
