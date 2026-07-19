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
    description: 'checkpoint lifecycle with shared-store capture and restore'
  - text: 'Reference: Store'
    link: '../reference/store'
---

<script setup lang="ts">
import { archivistDAG } from '../exampleDags.ts';
</script>

# Example 10: Shared State

## Shared Memory Surface

Shared State covers data that belongs to a session or host boundary rather than one edge in the DAG. The Archivist keeps RDF memory in a session-scoped `MemoryStore` so parent nodes, embedded search DAGs, and resume logic all read and write the same graph.

A `Store` handles long-lived structures that `stateMapping` or `gather` would otherwise force every node to carry through the graph: memory, audit trails, caches, ranked stores, or provenance indexes.

## Store-backed Archivist Flow

### DAG registration and diagram

The graph uses the real Archivist parent DAG because it already exercises parent placements, embedded sub-DAGs, and checkpoint resume against one shared `MemoryStore`. The store lives in injected services while the topology stays pure JSON-LD.

<DagJsonMermaid :dag="archivistDAG" title="The Archivist parent DAG" aria-label="The Archivist JSON-LD DAG beside Mermaid generated from it." />

### Run

```bash
pnpm run site:dev
```

Visit [The Archivist](./the-archivist), run a turn, save a checkpoint, then resume it to watch the shared memory store survive the pause.

## Store Injection Model

A `MemoryStore` is passed into each node's constructor. Parent and child nodes append entries to the same store without passing values through `inputs` or `gather`. `Checkpoint.capture` snapshots the store alongside parent state; `Checkpoint.load` and `restoreStores` restore it on resume. The code below is the real Archivist interactive host and CLI memory path.

The graph remains pure topology. The store is an injected dependency, so reusable DAGs can share host state without smuggling it through every placement.

## Code Samples

Read the snippets with the diagrams nearby so the TypeScript behavior, JSON-LD graph shape, and runtime output line up as one contract.

#### Store implementation

The Archivist `MemoryStore` is the session memory graph shared across turns and nodes:

<<< @/../examples/the-archivist/memory/MemoryStore.ts

#### Store in service state

The shared store is part of the `ArchivistServices` record injected into node constructors:

<<< @/../examples/the-archivist/services.ts#services-shape

#### Checkpoint capture with stores

The Archivist workflow captures the same memory store when the visitor saves a checkpoint:

<<< @/../examples/the-archivist/app/ArchivistRunner.vue#checkpoint-store-capture

#### Checkpoint restore with stores

On resume, the workflow restores the memory store before calling back into the dispatcher:

<<< @/../examples/the-archivist/app/ArchivistRunner.vue#checkpoint-store-restore

## Operational Uses

Shared state keeps long-lived domain structures off the edge payload while still making them available to every node that needs them. Memory graphs, caches, provenance stores, and audit logs stay in the host service layer while the DAG stays focused on control flow.

Checkpointing closes the loop: the same store can be captured with a parked run and restored before resume.

## Runtime Notes

- **Constructor/service injection.** Nodes receive `ArchivistServices`, which carries the shared `MemoryStore`.
- **Single store, many writers.** Recall, record, provenance, and projection paths read/write one session memory graph.
- **Embedded DAGs share services.** Embedded placements receive mapped state while their nodes still use the same service record.
- **`Checkpoint.capture({ stores })`.** Capturing a checkpoint with the `stores` option snapshots memory alongside state.
- **`restoreStores({ memory })`.** Resume restores the memory graph before the parked DAG continues.

See [Shared state](../guide/shared-state) for the decision matrix between `inputs`/`gather` (point-to-point transfer) and `Store` (accumulating shared structure), and the concurrency contract for write-write races across concurrent scatter clones.

## Related Concepts

- [Shared state guide](../guide/shared-state) - decision matrix, concurrency contract, checkpoint integration
- [Example 05: Embedded DAGs](./05-embedded-dags) - state transfer at the scatter boundary
- [Example 08: Checkpoint and Resume](./08-checkpoint) - checkpoint lifecycle with shared-store capture and restore
- [Reference: Store](../reference/store)
