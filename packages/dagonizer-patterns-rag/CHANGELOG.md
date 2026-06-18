# @studnicky/dagonizer-patterns-rag

## [Unreleased]

### Changed

- `LlmDispatchNode` owns `extractContent(response)`, which extracts prose
  from the chat-response discriminated union once. `DecisionNode` and
  `ComposeNode` call it instead of repeating the tool-vs-text guard.

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
