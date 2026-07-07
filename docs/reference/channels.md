---
title: 'Channels'
description: 'Handoff channel reference covering InMemoryChannel, published DAGHandoff envelopes, loopback behavior, and custom transport implementation points.'
seeAlso:
  - text: 'Reference: Contracts'
    link: './contracts'
    description: '`HandoffChannelInterface`'
  - text: 'Reference: Container'
    link: './container'
    description: 'pool-owning container base, `DagHost`'
  - text: 'Example 11: Operator Hand-Off'
    link: '../examples/11-handoff'
    description: 'two DAGs chained via an InMemoryChannel subclass'
  - text: 'Guide: Distribution and Cloud'
    link: '../guide/distribution'
    description: 'serverless handler pattern, Step Functions wiring, registryVersion handshake'
---

# Channels

## What It Is

Channels move `DAGHandoff` envelopes between DAG hosts. They are the boundary where one DAG finishes at a named terminal and another host receives enough information to continue work elsewhere.

Use this page when implementing an in-memory handoff, queue-backed handoff, serverless handoff, or custom transport that publishes `DAGHandoff` payloads.

## How It Works

A dispatcher publishes to a channel when a non-embedded flow reaches a terminal whose name is bound in `DagonizerOptionsType.channels`. The payload includes the terminal name, DAG name, state snapshot, and `registryVersion` for receiver-side compatibility checks.

`InMemoryChannel` is the local default and testing implementation. Production channels implement the same contract over queues, event buses, HTTP, workers, or cloud orchestration services.

## Diagrams, Examples, and Outputs

Channels are runtime transports rather than graph placements. These pages show the same handoff contract in runnable code and deployment guidance:

- [Reference: Contracts](./contracts) - `HandoffChannelInterface`
- [Reference: Container](./container) - pool-owning container base, `DagHost`
- [Example 11: Operator Hand-Off](../examples/11-handoff) - two DAGs chained via an InMemoryChannel subclass
- [Guide: Distribution and Cloud](../guide/distribution) - serverless handler pattern, Step Functions wiring, registryVersion handshake

## What It Lets You Do

The channels reference lets applications implement or use handoff transports that move `DAGHandoff` envelopes between DAG hosts.

Hand-off channel implementations. Ships through `@studnicky/dagonizer/channels`.

## Code Samples

The code below covers `InMemoryChannel`, published envelopes, loopback behavior, custom transport hooks, and the handoff contract.

### Import

```ts twoslash
import { InMemoryChannel } from '@studnicky/dagonizer/channels';
import type { InMemoryChannelOptionsType } from '@studnicky/dagonizer/channels';
```

---

### Class: `InMemoryChannel`

Local default and loopback `HandoffChannelInterface` implementation. Stores every published `DAGHandoff` envelope in an in-memory array. Deep-clones each envelope on publish via `structuredClone` to ensure full serialization fidelity.

```ts twoslash
import { InMemoryChannel } from '@studnicky/dagonizer/channels';
import type { InMemoryChannelOptionsType, } from '@studnicky/dagonizer/channels';
import type { HandoffChannelInterface } from '@studnicky/dagonizer/contracts';
import type { DAGHandoffType } from '@studnicky/dagonizer/entities';
// ---cut---
// class InMemoryChannel implements HandoffChannelInterface
//   constructor(options?: InMemoryChannelOptionsType)
//   get published(): readonly DAGHandoffType[]
//   get publishErrors(): readonly Error[]
//   publish(handoff: DAGHandoffType): Promise<void>
//   protected onPublished(handoff: DAGHandoffType): Promise<void>
const _check: HandoffChannelInterface = new InMemoryChannel();
```

#### Constructor

```ts twoslash
import { InMemoryChannel } from '@studnicky/dagonizer/channels';
// ---cut---
new InMemoryChannel();
new InMemoryChannel({});
```

`InMemoryChannelOptionsType` carries no fields; the type is the extension point for future channel configuration.

#### `published`

```ts twoslash
import { InMemoryChannel } from '@studnicky/dagonizer/channels';
import type { DAGHandoffType } from '@studnicky/dagonizer/entities';
const channel = new InMemoryChannel();
// ---cut---
const envelopes: readonly DAGHandoffType[] = channel.published;
```

All envelopes in publish order. Each entry is the deep-cloned, stored copy — independent from the dispatcher's internal state.

#### `publish(handoff)`

```ts twoslash
import { InMemoryChannel } from '@studnicky/dagonizer/channels';
import type { DAGHandoffType } from '@studnicky/dagonizer/entities';
const channel = new InMemoryChannel();
declare const handoff: DAGHandoffType;
// ---cut---
await channel.publish(handoff);
```

Deep-clones `handoff` via `structuredClone`, appends to `published`, then awaits `onPublished`. Errors thrown by `onPublished` are collected in `publishErrors` rather than re-thrown; the envelope is already recorded.

#### `onPublished(handoff)` (protected)

Default no-op. Override in a subclass to chain a downstream DAG. Receives the deep-cloned, stored envelope (same instance as the last entry in `published`).

**Extension via subclass, zero callbacks.** The dispatcher calls `channel.publish(handoff)` when a non-embedded flow reaches a terminal bound in `DagonizerOptionsType.channels`. The default `onPublished` is a no-op; subclass to restore state and run the continuation:

```ts twoslash
import { InMemoryChannel } from '@studnicky/dagonizer/channels';
import { Dagonizer } from '@studnicky/dagonizer';
import { NodeStateBase } from '@studnicky/dagonizer';
import type { DAGHandoffType } from '@studnicky/dagonizer/entities';
class AppState extends NodeStateBase {}
declare const downstreamDispatcher: Dagonizer<AppState>;
// ---cut---
class HandoffChannel extends InMemoryChannel {
  protected override async onPublished(handoff: DAGHandoffType): Promise<void> {
    if (!('stateSnapshot' in handoff) || handoff.stateSnapshot == null) return;
    const snapshot = handoff.stateSnapshot as import('@studnicky/dagonizer/entities').JsonObjectType;
    const state = AppState.restore(snapshot);
    await downstreamDispatcher.execute('continuation-dag', state);
  }
}

const dispatcher = new Dagonizer<AppState>({
  channels: { 'hand-off': new HandoffChannel() },
});
```

---

### Type: `InMemoryChannelOptionsType`

```ts twoslash
import type { InMemoryChannelOptionsType } from '@studnicky/dagonizer/channels';
// ---cut---
const _opts: InMemoryChannelOptionsType = {};
```

Constructor options for `InMemoryChannel`. Currently carries no fields. The type is the extension point for future channel configuration: adding a field here is non-breaking (callers that pass `{}` continue to compile).

---

### Implementing a real transport

Replace `InMemoryChannel` with any class that implements `HandoffChannelInterface`:

```ts twoslash
import type { HandoffChannelInterface } from '@studnicky/dagonizer/contracts';
import type { DAGHandoffType } from '@studnicky/dagonizer/entities';
declare const sqsClient: { sendMessage(params: { Body: string }): Promise<void> };
// ---cut---
class SqsChannel implements HandoffChannelInterface {
  async publish(handoff: DAGHandoffType): Promise<void> {
    // Never throw: the dispatcher does not catch channel errors.
    try {
      await sqsClient.sendMessage({ Body: JSON.stringify(handoff) });
    } catch (err) {
      // Log and swallow — the envelope payload is pure JSON.
    }
  }
}
```

`HandoffChannelInterface` ships through `@studnicky/dagonizer/contracts`. See [Guide: Distribution and Cloud](../guide/distribution) for the serverless handler pattern and `registryVersion` handshake.

---

## Details for Nerds

Channel payloads should be treated as serialized handoff envelopes. A receiving host still needs a compatible registry, registered DAG, and state restore path before it can continue execution.

Use `registryVersion` as the handshake between publisher and receiver. If the receiver cannot serve that registry version, reject or park the handoff instead of guessing.

## Related Concepts

- [Reference: Contracts](./contracts) - `HandoffChannelInterface`
- [Reference: Container](./container) - pool-owning container base, `DagHost`
- [Example 11: Operator Hand-Off](../examples/11-handoff) - two DAGs chained via an InMemoryChannel subclass
- [Guide: Distribution and Cloud](../guide/distribution) - serverless handler pattern, Step Functions wiring, registryVersion handshake
