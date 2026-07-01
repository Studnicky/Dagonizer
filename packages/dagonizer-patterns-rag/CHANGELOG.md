# @studnicky/dagonizer-patterns-rag

## 0.29.1

## 0.29.0

## 0.28.1

## 0.28.0

## 0.27.0

## 0.26.0

## 0.25.0

## 0.24.0

## 0.23.0

## 0.22.0

### Changed

- **Adapter-contract interfaces carry the `Interface` suffix (semver-major).** The framework contracts this package's public surface names are imported under their suffixed names: `ToolInterface` and `LlmClientInterface` (the service contracts the RAG pattern nodes call). The renames are type-only and propagate from `@studnicky/dagonizer`; runtime behavior is unchanged. Consumers typing against the old bare names (`Tool`, `LlmClient`) update to the suffixed names.
- `LlmDispatchNode` owns `extractContent(response)`, which extracts prose
  from the chat-response discriminated union once. `DecisionNode` and
  `ComposeNode` call it instead of repeating the tool-vs-text guard.
- **Naming: domain-class verbs (semver-major).** The pattern override seams are `ScoutNode.composeInput`, `LlmDispatchNode.composePrompt`, `LlmDispatchNode.composeRequest`, and `DecisionNode.decodeChoice`. Subclasses override these names; behavior is unchanged.

## 0.21.0

## 0.20.0

## 0.19.0

## 0.17.0

## 0.16.0

## 0.15.0

## 0.14.0

### Patch Changes

- Updated dependencies [d3a4e7b]
  - @studnicky/dagonizer@0.14.0

## 0.13.2

### Patch Changes

- Updated dependencies [238a94d]
  - @studnicky/dagonizer@0.13.2

## 0.12.0

### Patch Changes

- Updated dependencies [7c0e38a]
- Updated dependencies [3286d07]
  - @studnicky/dagonizer@0.12.0
