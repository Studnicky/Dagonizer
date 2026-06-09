---
title: 'Phase 10: Shared state'
description: 'Cross-DAG shared state via Store, MemoryStore, and TypedStore. Parent and child DAGs read and write the same backing store through the services bag, with a checkpoint round-trip that preserves the store across resume.'
seeAlso:
  - text: 'Shared state guide'
    link: '../guide/shared-state'
    description: 'decision matrix, concurrency contract, checkpoint integration'
  - text: 'Phase 05: Scatter sub-DAG composition'
    link: './05-embedded-dags'
    description: 'state transfer at the scatter boundary'
  - text: 'Phase 08: Checkpoint + resume'
    link: './08-checkpoint'
    description: 'checkpoint lifecycle this page extends with stores'
  - text: 'Reference: Store'
    link: '../reference/store'
---

<script setup lang="ts">
import { DAGBuilder, NodeStateBase } from '@noocodex/dagonizer';
import type { NodeInterface } from '@noocodex/dagonizer';

interface Services { log: { update: (k: string, fn: (c?: string) => string) => Promise<void> } }

const noop: NodeInterface<NodeStateBase, 'done', Services> = {
  name: 'noop',
  outputs: ['done'],
  async execute() { return { output: 'done' }; },
};

const stepA = { ...noop, name: 'step-a' };
const stepB = { ...noop, name: 'step-b' };
const childStep = { ...noop, name: 'child-step' };

const childDag = new DAGBuilder('sub-flow', '1')
  .node('child-step', childStep, { done: null })
  .build();

const parentDag = new DAGBuilder('main-flow', '1')
  .node('step-a', stepA, { done: 'run-child' })
  .embeddedDAG('run-child', 'sub-flow', { success: 'step-b', error: 'step-b' })
  .node('step-b', stepB, { done: null })
  .build();

const sharedStateRegistry = new Map([['sub-flow', childDag]]);
</script>

# Phase 10: Shared state

A `MemoryStore` lives on the services bag, threaded through every node and every scatter clone. Parent and child append entries to the same store without passing values through `inputs` or `gather`. `Checkpoint.capture` snapshots the store alongside the parent state; `Checkpoint.load` + `restoreStores` restores it on resume.

<DagGraph :dag="parentDag" :embedded-d-a-gs="sharedStateRegistry" :expand-all="true" aria-label="Parent DAG with embedded-DAG sub-flow; both write to the same shared store." />

## Code

### Services bag with a `Store`

The services bag declares one field of type `Store`. The dispatcher binds a concrete `MemoryStore` instance at construction time; every node sees the same instance via `context.services.log`:

<<< @/../examples/dags/10-shared-state.ts#services

### Child DAG

The child DAG runs a single `child-step` placement; it never references the store directly. The store lives outside the topology:

<<< @/../examples/dags/10-shared-state.ts#child-dag

### Parent DAG with embedded-DAG placement

`run-child` is the embedded-DAG placement. Parent and child both call `context.services.log.update(...)` against the same backing store, so `step-a`, `child-step`, and `step-b` accumulate to one entry list in execution order:

<<< @/../examples/dags/10-shared-state.ts#parent-dag

### Store initialisation + run

The dispatcher takes the store on `services`. After execution, the same instance carries the writes from every node:

<<< @/../examples/10-shared-state.ts#store-init

### Full round-trip (normal run, then checkpoint + resume)

The runnable example covers the full lifecycle: a normal run, then a second run that aborts after `step-a`, captures the partial state plus the store, restores the store into a fresh `MemoryStore`, and resumes:

<<< @/../examples/10-shared-state.ts#run

## What it demonstrates

- **`Store` on the services bag.** `Dagonizer<TState, TServices>` is generic over the services shape. The `MemoryStore` instance is the same reference every node receives via `context.services.log`. See the `services` region.
- **Single store, many writers.** `step-a`, `child-step`, `step-b` all call `log.update('entries', ...)` against one instance. Order of the resulting entries reflects execution order, not topology.
- **Scatter clones inherit the services bag.** `child-step` sees the same `log` as the parent without any `inputs` or `gather` for the store. `inputs`/`gather` are for parent/clone state transfer; stores are orthogonal.
- **`Checkpoint.capture({ stores })`.** Capturing a checkpoint with the `stores` option snapshots each named store alongside the state. The capture is keyed by the same name the services bag uses (`log`).
- **`Checkpoint.load(...).restoreStores({ log: freshLog })`.** Restores the store contents into a fresh instance. The resumed dispatcher uses the fresh instance on its services bag, so the resume continues from the captured store contents.
- **Resume is order-preserving.** After restoreStores plus resume, the final `entries` value is `step-a,child-step,step-b` with no duplication, identical to the normal-run output.

See [Shared state](../guide/shared-state) for the decision matrix between `inputs`/`gather` (point-to-point transfer) and `Store` (accumulating shared structure), and the concurrency contract for write-write races across concurrent scatter clones.
