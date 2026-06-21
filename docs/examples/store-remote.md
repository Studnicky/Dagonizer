---
title: 'Example: Remote store (GrpcStore stub)'
description: 'GrpcStore extends BaseStore and implements RemoteStoreInterface. Network methods print to stdout instead of making real gRPC calls. The in-memory data map is identical in behaviour to a real remote store.'
seeAlso:
  - text: 'Phase 10: Shared state'
    link: './10-shared-state'
    description: 'Store on the services bag with checkpoint round-trip'
  - text: 'Shared state guide'
    link: '../guide/shared-state'
    description: 'Store, MemoryStore, TypedStore, and RemoteStoreInterface'
  - text: 'Reference: Store'
    link: '../reference/store'
    description: 'BaseStore, RemoteStoreInterface, MemoryStore API reference'
---

# Example: Remote store (GrpcStore stub)

`GrpcStore` extends `BaseStore` and implements `RemoteStoreInterface`. Its network methods (`connect`, `disconnect`, `health`, `acquireLease`, `releaseLease`) print to stdout instead of making real gRPC calls — this is a stub standing in for a real gRPC backend. The in-memory data map is identical in behaviour to a real remote store: put/get/delete round-trips work exactly as a production implementation would.

Use this as a template for implementing a real gRPC (or REST/Redis/S3) remote store: replace `performGet`/`performSet`/`performDelete` with real client calls and implement `connect`/`disconnect` against your actual service endpoint.

## Code

<<< @/../examples/store-remote.ts

## What it demonstrates

- **`BaseStore` extension.** `BaseStore` provides the `get`/`set`/`delete`/`has`/`update` API and the `snapshot`/`restore` round-trip. Subclasses implement the three protected abstract methods: `performGet`, `performSet`, `performDelete`.
- **`RemoteStoreInterface`.** Adds `connect`, `disconnect`, `health`, `acquireLease`, and `releaseLease` to the base contract. These hooks are called by connection-aware consumers (service containers, long-lived workers) to manage the store's network lifecycle.
- **`acquireLease` / `releaseLease`.** Distributed-lock primitives. `acquireLease(key, ttlMs, waitMs)` returns a `Lease` token; `releaseLease(lease)` releases it. The stub implements optimistic single-process locking — replace with a real distributed lock in production.
- **`snapshot` / `restore` round-trip.** `BaseStore.snapshot()` returns a serialisable `StoreSnapshotType`; `BaseStore.restore(snapshot)` rehydrates the in-memory map. Used by `Checkpoint.capture` to include store contents in the checkpoint.

## Run

```bash
npx tsx examples/store-remote.ts
```
