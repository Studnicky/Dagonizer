---
title: 'Example 11: Loopback hand-off'
description: 'Two DAGs chained via an InMemoryChannel subclass. DAG A completes at a bound terminal and publishes a DAGHandoff envelope; the channel onPublished override restores state and runs DAG B in the same process.'
seeAlso:
  - text: 'Guide: Distribution and cloud patterns'
    link: '../guide/distribution'
    description: 'serverless handler pattern, Step Functions wiring, registryVersion handshake'
  - text: 'Example 12: Worker pool'
    link: './12-workers'
    description: 'run a scatter-dag-body over a real WorkerThreadContainer pool'
  - text: 'Reference: Entities, DAGHandoff'
    link: '../reference/entities'
  - text: 'Reference: Contracts, HandoffChannelInterface'
    link: '../reference/contracts'
---

# Example 11: Loopback hand-off

This example chains two DAGs end-to-end using the hand-off channel mechanism. A subclass of `InMemoryChannel` stands in for a real queue transport. When DAG A completes at the `handoff` terminal, the dispatcher publishes a `DAGHandoff` envelope to the channel. The subclass overrides the protected `onPublished` hook to restore the envelope's state snapshot and run DAG B, demonstrating the full round-trip in a single process.

## Key concept

The grain of a hand-off is the DAG, not a single node. DAG A runs to completion inside the first dispatcher call; the terminal state snapshot becomes the `DAGHandoff` envelope's `stateSnapshot`. DAG B restores from that snapshot and runs to completion in its own dispatcher call. Neither DAG knows about the other; the channel wires them.

```
dispatcher.execute(dagAName, state)
  │
  └─ reaches 'handoff' terminal
       │
       └─ channel.publish(DAGHandoff { stateSnapshot, ... })
              │
              └─ onPublished override: restore state → dispatcher.execute(dagBName, restoredState)
```

This is the same pattern a serverless function handler uses across a real message queue — the in-process `InMemoryChannel` loopback lets you develop and test the full chain without infrastructure.

## Key APIs

| Symbol | Import | Role |
|--------|--------|------|
| `InMemoryChannel` | `@noocodex/dagonizer/channels` | Stores envelopes; calls the protected `onPublished` hook after each publish |
| `InMemoryChannel.onPublished` | `@noocodex/dagonizer/channels` | Protected hook to override in a subclass to chain the downstream DAG |
| `DAGHandoff` | `@noocodex/dagonizer/entities` | Wire-safe envelope with `stateSnapshot`, `terminalName`, `registryVersion`, `correlationId` |
| `DagonizerOptionsInterface.channels` | `@noocodex/dagonizer` | Binds terminal names to `HandoffChannelInterface` instances |

The `channels` option is a `Record<terminalName, HandoffChannelInterface>`. Terminals not listed follow the default path — no publish, the run completes normally.

## What it demonstrates

- **`channels` binding.** Constructing a dispatcher with `channels: { handoff: channel }` activates the publish step for the `handoff` terminal. Any other terminal in the DAG completes normally without publishing.
- **`onPublished` chain (extension via subclass, zero callbacks).** Subclass `InMemoryChannel` and override the protected `onPublished(handoff)` hook. After recording the deep-cloned envelope, `publish` awaits the override. The override restores state from `handoff.stateSnapshot` and calls the downstream dispatcher's `execute`.
- **Envelope fidelity.** `InMemoryChannel.publish` calls `structuredClone` on every envelope before storing it. The stored copy is independent from the dispatcher's internal state. The example asserts that the restored state in DAG B matches the terminal state of DAG A — the round-trip (`snapshot → structuredClone → restore → snapshot`) is a fixed point.
- **`registryVersion` handshake.** The envelope carries `registryVersion`. A real receiver validates this before calling `restore`; the example shows the check pattern.
- **Embedded child DAGs do not publish.** Only the top-level dispatcher call triggers a channel publish. If DAG A contains embedded DAGs, their completions do not publish envelopes.

## Run

```bash
pnpm run example:11
```

Source: [`examples/11-handoff.ts`](../../examples/11-handoff.ts)

## Extending to a real transport

Replace `InMemoryChannel` with a class that implements `HandoffChannelInterface` and sends to your queue:

<<< @/../examples/dags/11-handoff.ts#queue-channel-pattern

See [Distribution and cloud patterns](../guide/distribution) for the serverless handler pattern, Step Functions wiring, and idempotency guidance.
