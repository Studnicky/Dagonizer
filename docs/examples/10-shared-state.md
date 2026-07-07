---
title: 'Example 10: Shared State'
description: 'Cross-DAG shared state via Store, MemoryStore, and TypedStore. Parent and child DAGs read and write the same backing store injected into each node constructor, with a checkpoint round-trip that preserves the store across resume.'
seeAlso:
  - text: 'Shared state guide'
    link: '../guide/shared-state'
    description: 'decision matrix, concurrency contract, checkpoint integration'
  - text: 'Example 05: Embedded DAGs'
    link: './05-embedded-dags'
    description: 'state transfer at the scatter boundary'
  - text: 'Example 08: Checkpoint and Resume'
    link: './08-checkpoint'
    description: 'checkpoint lifecycle this page extends with stores'
  - text: 'Reference: Store'
    link: '../reference/store'
---

<script setup lang="ts">
import { archivistDAG } from '../.vitepress/theme/exampleDags.ts';
</script>

# Example 10: Shared State

## What It Is

Shared State is for data that belongs to a session or application boundary, not to one edge in the DAG. The Archivist uses a session `MemoryStore` so parent nodes, embedded search DAGs, and resume logic can read and write the same memory graph.

Use this when `stateMapping` or `gather` would force every node to pass around a growing structure that is really a shared service: memory, audit trails, caches, ranked stores, or provenance indexes.

## How It Works

A `MemoryStore` is passed into each node's constructor. Parent and child nodes append entries to the same store without passing values through `inputs` or `gather`. `Checkpoint.capture` snapshots the store alongside parent state; `Checkpoint.load` and `restoreStores` restore it on resume. The code below is the real Archivist browser/CLI memory path.

The graph remains pure topology. The store is an injected dependency, so reusable DAGs can share application state without smuggling it through every placement.

## Diagrams, Examples, and Outputs

### DAG registration and diagram

The graph is the production-shaped pattern in [The Archivist](./the-archivist): parent placements and embedded search/compose sub-DAGs share the session `MemoryStore` through injected services while the topology stays pure JSON-LD.

<DagJsonMermaid :dag="archivistDAG" title="The Archivist parent DAG" aria-label="The Archivist JSON-LD DAG beside Mermaid generated from it." />

### Run

```bash
npm run docs:dev
```

## What It Lets You Do

Shared state lets applications accumulate data across parent DAGs, embedded DAGs, and scatter clones without threading every value through `stateMapping` or `gather`. Use it for memory graphs, caches, audit logs, ranked stores, and other structures that many nodes read or write over time.

For an application, this keeps the DAG readable while still supporting long-lived domain state. The parent graph says what runs next; the store owns the durable structure multiple nodes collaborate on.

## Code Samples

Read the snippets with the diagrams nearby so the TypeScript behavior, JSON-LD graph shape, and runtime output line up as one contract.

#### Store implementation

The Archivist `MemoryStore` is the session memory graph shared across turns and nodes:

<<< @/../examples/the-archivist/memory/MemoryStore.ts

#### Store in service state

The shared store is part of the `ArchivistServices` record injected into node constructors:

<<< @/../examples/the-archivist/services.ts#services-shape

#### Checkpoint capture with stores

The browser session captures the same memory store when a run parks for HITL:

<<< @/../examples/the-archivist/DomArchivistSession.ts#checkpoint-store-capture

#### Checkpoint restore with stores

On resume, the browser restores the memory store before calling back into the dispatcher:

<<< @/../examples/the-archivist/DomArchivistSession.ts#checkpoint-store-restore

## Details for Nerds

- **Constructor/service injection.** Nodes receive `ArchivistServices`, which carries the shared `MemoryStore`.
- **Single store, many writers.** Recall, record, provenance, and projection paths read/write one session memory graph.
- **Embedded DAGs share services.** Embedded placements receive mapped state while their nodes still use the same service record.
- **`Checkpoint.capture({ stores })`.** Capturing a checkpoint with the `stores` option snapshots memory alongside state.
- **`restoreStores({ memory })`.** Resume restores the memory graph before the parked DAG continues.

See [Shared state](../guide/shared-state) for the decision matrix between `inputs`/`gather` (point-to-point transfer) and `Store` (accumulating shared structure), and the concurrency contract for write-write races across concurrent scatter clones.

## Related Concepts

- [Shared state guide](../guide/shared-state) - decision matrix, concurrency contract, checkpoint integration
- [Example 05: Embedded DAGs](./05-embedded-dags) - state transfer at the scatter boundary
- [Example 08: Checkpoint and Resume](./08-checkpoint) - checkpoint lifecycle this page extends with stores
- [Reference: Store](../reference/store)
