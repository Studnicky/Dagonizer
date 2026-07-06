---
title: 'Phase 10: Shared state'
description: 'Cross-DAG shared state via Store, MemoryStore, and TypedStore. Parent and child DAGs read and write the same backing store injected into each node constructor, with a checkpoint round-trip that preserves the store across resume.'
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
import { Batch, DAGBuilder, MonadicNode, NodeStateBase, RoutedBatch } from '@studnicky/dagonizer';
import type { SchemaObjectType } from '@studnicky/dagonizer';

class DoneNode extends MonadicNode<NodeStateBase, 'done'> {
  readonly outputs: readonly 'done'[] = ['done'];

  constructor(readonly name: string) {
    super();
  }

  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { done: { type: 'object' } };
  }

  async execute(batch: Batch<NodeStateBase>) {
    return RoutedBatch.create('done', batch);
  }
}

const childDag = new DAGBuilder('sub-flow', '1')
  .node('child-step', new DoneNode('child-step'), { done: 'child-end' })
  .terminal('child-end')
  .build();

const parentDag = new DAGBuilder('main-flow', '1')
  .node('step-a', new DoneNode('step-a'), { done: 'run-child' })
  .embeddedDAG('run-child', 'sub-flow', { success: 'step-b', error: 'step-b' })
  .node('step-b', new DoneNode('step-b'), { done: 'end' })
  .terminal('end')
  .build();

const sharedStateRegistry = new Map([['sub-flow', childDag]]);
</script>

# Phase 10: Shared state

A `MemoryStore` is passed into each node's constructor. Parent and child append entries to the same store without passing values through `inputs` or `gather`. `Checkpoint.capture` snapshots the store alongside the parent state; `Checkpoint.load` + `restoreStores` restores it on resume.

<DagGraph :dag="parentDag" :embedded-d-a-gs="sharedStateRegistry" :expand-all="true" aria-label="Parent DAG with embedded-DAG sub-flow; both write to the same shared store." />

## Code

### Constructor injection

Each node accepts a `StoreInterface` in its constructor. The same `MemoryStore` instance is passed to all three nodes at registration time; every node accesses it as a private field:

<<< @/../examples/dags/10-shared-state.ts#services-node

### Child DAG

The child DAG runs a single `child-step` placement; it never references the store directly. The store lives outside the topology:

<<< @/../examples/dags/10-shared-state.ts#child-dag

### Parent DAG with embedded-DAG placement

`run-child` is the embedded-DAG placement. Parent and child both call `this.log.update(...)` against the same constructor-injected store, so `step-a`, `child-step`, and `step-b` accumulate to one entry list in execution order:

<<< @/../examples/dags/10-shared-state.ts#parent-dag

### Store initialisation + run

The `MemoryStore` is constructed before the nodes and passed into each node at registration. After execution, the same instance carries the writes from every node:

<<< @/../examples/10-shared-state.ts#store-init

### Full round-trip (normal run, then checkpoint + resume)

The runnable example covers the full lifecycle: a normal run, then a second run that aborts after `step-a`, captures the partial state plus the store, restores the store into a fresh `MemoryStore`, and resumes:

<<< @/../examples/10-shared-state.ts#run

## What it demonstrates

- **Constructor injection.** Each node accepts a `StoreInterface` in its constructor. The `MemoryStore` is constructed once and passed to `new StepANode(log)`, `new ChildStepNode(log)`, and `new StepBNode(log)` at registration time.
- **Single store, many writers.** `step-a`, `child-step`, `step-b` all call `this.log.update('entries', ...)` against the same instance. Order of the resulting entries reflects execution order, not topology.
- **Embedded-DAG child shares the store.** `child-step` holds the same `log` instance as the parent nodes — passed via constructor, not threaded through `inputs` or `gather`. `inputs`/`gather` are for parent/clone state transfer; stores are orthogonal.
- **`Checkpoint.capture({ stores })`.** Capturing a checkpoint with the `stores` option snapshots each named store alongside the state. The store is keyed by a name matching what `restoreStores` expects (`log`).
- **`Checkpoint.load(...).restoreStores({ log: freshLog })`.** Restores the store contents into a fresh instance. The resumed nodes are constructed with the fresh store instance, so the resume continues from the captured store contents.
- **Resume is order-preserving.** After restoreStores plus resume, the final `entries` value is `step-a,child-step,step-b` with no duplication, identical to the normal-run output.

See [Shared state](../guide/shared-state) for the decision matrix between `inputs`/`gather` (point-to-point transfer) and `Store` (accumulating shared structure), and the concurrency contract for write-write races across concurrent scatter clones.
