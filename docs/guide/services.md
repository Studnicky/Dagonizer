---
title: 'Services container'
description: 'Typed services record wired into the dispatcher; every node reads it via context.services.'
seeAlso:
  - text: 'Subclassing State'
    link: './subclassing'
    description: 'services are dispatcher-scoped; per-execution data lives on state'
  - text: 'Observability'
    link: './observability'
    description: 'pass loggers or tracers through the services record'
  - text: 'State accessors'
    link: './state-accessor'
    description: 'accessor + services together customize what nodes see'
---

# Services container

`DagonizerOptionsType.services` accepts a typed record of dependencies. The same reference flows through every node as `context.services`. Nodes never construct their own clients; they read from `context.services`.

## API surface

| Symbol | Source | Role |
|--------|--------|------|
| `Dagonizer<TState, TServices>` | `@studnicky/dagonizer` | Carries the services type as a generic parameter |
| `DagonizerOptionsType.services` | `@studnicky/dagonizer` | The record passed at construction |
| `NodeInterface<TState, TOutput, TServices>` | `@studnicky/dagonizer` | Propagates `TServices` to `context.services` |
| `NodeContextType.services` | `@studnicky/dagonizer` | The per-call view of the services record |

`TServices` defaults to `undefined`. Dispatchers that need nothing typed through services work as `new Dagonizer<S>()`.

## Defining the services record

Consumers declare a plain interface. There is no DI container, no provider scope, no factory step.

<<< @/../examples/the-archivist/services.ts#services-shape

## Constructing the dispatcher

<<< @/../examples/the-archivist/main.ts#wire-services

## How services flow

```mermaid
flowchart TB
  ctor([new Dagonizer]):::svc
  record([services record]):::svc
  dispatch[dispatcher]:::svc
  ctx([NodeContext.services]):::svc
  node[node.execute]
  record --> ctor
  ctor --> dispatch
  dispatch -->|every node| ctx
  ctx --> node
  classDef svc fill:transparent,stroke:var(--mermaid-state-stroke,#b18cff),stroke-dasharray:3 3
```

The diagram captures the wiring, not a DAG. The record is constructor-scoped; the dispatcher hands the same reference to every node in every execution.

## Receiving services in a node

`NodeInterface<TState, TOutput, TServices>` propagates the same parameter to `context.services`:

<<< @/../examples/dags/10-shared-state.ts#services-node

The generic parameter narrows `context.services` inside the node body.

## Mixing services-aware and services-free nodes

Nodes without a services parameter (`NodeInterface<S, 'success'>`, default `TServices = undefined`) cannot register on a dispatcher with non-`undefined` services because the registration signature requires the same `TServices`. Either:

- Always declare the services record (most consistent).
- Or split into two dispatchers, one with services and one without, when nodes truly cannot share a record.

In practice the services record is wide enough to cover everything a flow needs, and every node accepts the same parameter.

## Lifetime

Services live on the dispatcher instance. There is no per-execution scope; the same record is handed to every node in every execution, including scatter clones and sub-DAG bodies.

If a service needs per-execution state (such as a request ID), put the per-execution data in `state` instead. The record is for things that outlive any one execution.

## `AgentServicesType`

`AgentServicesType` is the canonical services record for agent-flow dispatchers. It is exported from `@studnicky/dagonizer/contracts` and typed as:

```ts
import type { LlmAdapterInterface } from '@studnicky/dagonizer/contracts';
import type { ToolRegistry } from '@studnicky/dagonizer/tool';

type AgentServicesType = {
  readonly llm: LlmAdapterInterface;
  readonly tools: ToolRegistry;
};
```

Wire it at dispatcher construction time:

```ts
import { Dagonizer } from '@studnicky/dagonizer';
import type { AgentServicesType } from '@studnicky/dagonizer/contracts';

const dispatcher = new Dagonizer<MyState, AgentServicesType>({
  services: { llm: myLlmAdapter, tools: myToolRegistry },
});
```

Nodes receive `context.services.llm` (the `LlmAdapterInterface` for chat calls) and `context.services.tools` (the `ToolRegistry` for tool dispatch). No `dispatcher` field exists on this record; the engine wires the dispatcher internally and it is not exposed through the services surface.

## Related reference

- [Reference: Dagonizer](../reference/dagonizer)
- [Reference: Contracts](../reference/contracts)
- [Demo: The Archivist](../examples/the-archivist) wires a real services record
