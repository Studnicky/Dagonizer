---
title: 'Example 36: DAG Stream Producer'
description: 'The Archivist streaming flow bridges an inner candidate-discovery DAG into an outer scatter source through BookSearchStreamProducer.'
seeAlso:
  - text: 'Example 34: Producer feed DAGs'
    link: './34-stream-channel'
    description: 'Cartographer producer feed DAG assembly'
  - text: 'Example 20: Streaming execution'
    link: './20-streaming'
    description: 'per-node AsyncIterable execution'
  - text: 'Streaming Producers'
    link: '../guide/streaming-producers'
    description: 'full streaming API: driven, fanIn, resumable, DagStreamProducer'
---

<script setup lang="ts">
import { archivistStreamProducerDAG } from '../exampleDags.ts';
</script>

# Example 36: DAG Stream Producer

## Stream Producer Boundary

DAG Stream Producer lets one DAG feed another DAG. The Archivist streaming flow runs an inner candidate-discovery DAG, selects candidate records from its node-result stream, and exposes those records as the source for an outer scatter.

This is useful when upstream discovery is itself a workflow, not a simple generator. The inner DAG can do real orchestration while the outer DAG consumes selected intermediate results as a bounded stream.

## Registered Flow

### DAG registration and diagram

The [Archivist](./the-archivist) streaming flow uses `BookSearchStreamProducer`, a `DagStreamProducer<CandidateType>` subclass. It runs an inner candidate-discovery DAG, selects candidates from the inner node-result stream, and feeds them into an outer scatter via `StreamChannel.driven(...)`.

<DagJsonMermaid :dag="archivistStreamProducerDAG" title="Archivist DagStreamProducer outer scatter" aria-label="Archivist DagStreamProducer JSON-LD DAG beside Mermaid generated from it." />

The Mermaid diagram shows the outer scatter. The producer code shows the nested inner DAG execution stream that supplies items to that scatter.

### Run

```bash
npx tsx examples/the-archivist/runArchivistStreaming.ts
```

## Inner-to-Outer Stream Wiring

The producer starts an inner `dispatcher.execute(...)` and iterates its node-result stream. Its `select(stage)` method filters the inner stages down to emitted items. `StreamChannel.driven(...)` exposes those items as an async source to the outer scatter, preserving back-pressure across the inner and outer DAG boundary.

The boundary is still explicit. The inner DAG owns candidate discovery; the producer selects what leaves that DAG; the outer scatter owns downstream fan-out and gather.

## Code Samples

The producer bridges inner DAG stages into candidate items:

<<< @/../examples/the-archivist/streaming/BookSearchStreamProducer.ts

The outer DAG scatters over the driven stream:

<<< @/../examples/the-archivist/streaming/ArchivistStreamingDAGs.ts

The CLI entry point wires the producer into `StreamChannel.driven(...)` and asserts all candidates arrive:

<<< @/../examples/the-archivist/runArchivistStreaming.ts

## Usage

`DagStreamProducer` lets one DAG become the source for another DAG. It fits upstream discovery that is itself a workflow: a search DAG, a crawler DAG, a planning DAG, or an agent loop can emit selected intermediate results into a downstream scatter without waiting for the inner DAG's final terminal state.

The host-level benefit is latency and composition. Downstream work can begin as soon as useful inner stages emit, while the inner DAG continues toward its own terminal state.

## Runtime Notes

- **Inner DAG as producer.** `BookSearchStreamProducer.executions()` runs `candidate-discovery` and yields per-node stages.
- **Selective emission.** `select(stage)` emits only candidates discovered by the inner `discover-candidates` stage.
- **Back-pressure across DAG boundaries.** `StreamChannel.driven(..., { capacity: 2 })` bounds the outer scatter source.
- **Archivist domain fixtures.** The flow uses real Archivist `CandidateType` records and fixture scout batches.

## Related Concepts

- [Example 34: Producer feed DAGs](./34-stream-channel) - Cartographer producer feed DAG assembly
- [Example 20: Streaming execution](./20-streaming) - per-node AsyncIterable execution
- [Streaming Producers](../guide/streaming-producers) - full streaming API: driven, fanIn, resumable, DagStreamProducer
