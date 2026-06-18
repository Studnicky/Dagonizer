# @studnicky/dagonizer-store-eventlog

## [Unreleased]

### Changed

- `EventLogStore.#latest` returns the honest stored type `JsonValue | undefined` instead of an unchecked `as T` per call site. A single documented caller-expectation boundary cast lives in `#latestAs`, through which both `performGet` and the atomic `update` override read; it is the store's only unchecked cast.

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
