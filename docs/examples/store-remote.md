---
title: 'Remote Store'
description: 'GrpcStore extends BaseStore and implements RemoteStoreInterface. Network methods print to stdout instead of making real gRPC calls. The in-memory data map is identical in behaviour to a real remote store.'
seeAlso:
  - text: 'Example 10: Shared State'
    link: './10-shared-state'
    description: 'Store injected via node constructors with checkpoint round-trip'
  - text: 'Shared state guide'
    link: '../guide/shared-state'
    description: 'Store, MemoryStore, TypedStore, and RemoteStoreInterface'
  - text: 'Reference: Store'
    link: '../reference/store'
    description: 'BaseStore, RemoteStoreInterface, MemoryStore API reference'
---

# Remote Store

## What It Is

Remote Store shows how to put shared DAG state behind a service boundary. The example `GrpcStore` extends `BaseStore` and implements `RemoteStoreInterface`; its network methods print to stdout, while its data operations behave like a real remote store.

This is a store-contract example rather than a graph-topology example. It is the template for replacing in-process memory with gRPC, REST, Redis, S3, or another process-owned state service.

## How It Works

`BaseStore` owns the normal store API and snapshot/restore mechanics. `RemoteStoreInterface` adds lifecycle and coordination hooks: `connect`, `disconnect`, `health`, `acquireLease`, and `releaseLease`.

## Diagrams, Examples, and Outputs

This page has no DAG diagram because it demonstrates a store implementation, not a routed graph. The CLI run shows the connection lifecycle, read/write/delete behavior, lease handling, and snapshot/restore round-trip.

### Run

```bash
npx tsx examples/store-remote.ts
```

## What It Lets You Do

Remote stores let applications keep shared DAG state behind a service boundary while preserving the same `Store` and checkpoint contracts. Use this when memory, cache, checkpoint-adjacent data, or locks must survive one process and coordinate across workers.

`GrpcStore` extends `BaseStore` and implements `RemoteStoreInterface`. Its network methods (`connect`, `disconnect`, `health`, `acquireLease`, `releaseLease`) print to stdout instead of making real gRPC calls — this is a stub standing in for a real gRPC backend. The in-memory data map is identical in behaviour to a real remote store: put/get/delete round-trips work exactly as a production implementation would.

Use this as a template for implementing a real gRPC (or REST/Redis/S3) remote store: replace `performGet`/`performSet`/`performDelete` with real client calls and implement `connect`/`disconnect` against your actual service endpoint.

## Code Samples

<<< @/../examples/store-remote.ts

## Details for Nerds

- **`BaseStore` extension.** `BaseStore` provides the `get`/`set`/`delete`/`has`/`update` API and the `snapshot`/`restore` round-trip. Subclasses implement the three protected abstract methods: `performGet`, `performSet`, `performDelete`.
- **`RemoteStoreInterface`.** Adds `connect`, `disconnect`, `health`, `acquireLease`, and `releaseLease` to the base contract. These hooks are called by connection-aware hosts (service containers, long-lived workers) to manage the store's network lifecycle.
- **`acquireLease` / `releaseLease`.** Distributed-lock primitives. `acquireLease(key, ttlMs, waitMs)` returns a `Lease` token; `releaseLease(lease)` releases it. The stub implements optimistic single-process locking — replace with a real distributed lock in production.
- **`snapshot` / `restore` round-trip.** `BaseStore.snapshot()` returns a serialisable `StoreSnapshotType`; `BaseStore.restore(snapshot)` rehydrates the in-memory map. Used by `Checkpoint.capture` to include store contents in the checkpoint.

## Related Concepts

- [Example 10: Shared State](./10-shared-state) - Store injected via node constructors with checkpoint round-trip
- [Shared state guide](../guide/shared-state) - Store, MemoryStore, TypedStore, and RemoteStoreInterface
- [Reference: Store](../reference/store) - BaseStore, RemoteStoreInterface, MemoryStore API reference
