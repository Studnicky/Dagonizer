---
seeAlso:
  - text: 'Reference: Contracts'
    link: './contracts'
    description: '`HandoffChannelInterface`, `MessageHandoffChannelInterface`'
  - text: 'Reference: Container'
    link: './container'
    description: 'pool-owning container base, `DagHost`'
  - text: 'Example 11: Loopback hand-off'
    link: '../examples/11-handoff'
    description: 'two DAGs chained via an InMemoryChannel subclass'
  - text: 'Guide: Distribution and cloud'
    link: '../guide/distribution'
    description: 'serverless handler pattern, Step Functions wiring, registryVersion handshake'
---

# Channels

Hand-off channel implementations. Ships through `@studnicky/dagonizer/channels`.

```ts twoslash
import { InMemoryChannel } from '@studnicky/dagonizer/channels';
import type { InMemoryChannelOptions } from '@studnicky/dagonizer/channels';
```

---

## Class: `InMemoryChannel`

Local default and loopback `HandoffChannelInterface` implementation. Stores every published `DAGHandoff` envelope in an in-memory array. Deep-clones each envelope on publish via `structuredClone` to ensure full serialization fidelity.

```ts twoslash
import { InMemoryChannel } from '@studnicky/dagonizer/channels';
import type { InMemoryChannelOptions, } from '@studnicky/dagonizer/channels';
import type { HandoffChannelInterface } from '@studnicky/dagonizer/contracts';
import type { DAGHandoff } from '@studnicky/dagonizer/entities';
// ---cut---
// class InMemoryChannel implements HandoffChannelInterface
//   constructor(options?: InMemoryChannelOptions)
//   get published(): readonly DAGHandoff[]
//   get publishErrors(): readonly Error[]
//   publish(handoff: DAGHandoff): Promise<void>
//   protected onPublished(handoff: DAGHandoff): Promise<void>
const _check: HandoffChannelInterface = new InMemoryChannel();
```

### Constructor

```ts twoslash
import { InMemoryChannel } from '@studnicky/dagonizer/channels';
// ---cut---
new InMemoryChannel();
new InMemoryChannel({});
```

`InMemoryChannelOptions` carries no fields; the type is the extension point for future channel configuration.

### `published`

```ts twoslash
import { InMemoryChannel } from '@studnicky/dagonizer/channels';
import type { DAGHandoff } from '@studnicky/dagonizer/entities';
const channel = new InMemoryChannel();
// ---cut---
const envelopes: readonly DAGHandoff[] = channel.published;
```

All envelopes in publish order. Each entry is the deep-cloned, stored copy — independent from the dispatcher's internal state.

### `publish(handoff)`

```ts twoslash
import { InMemoryChannel } from '@studnicky/dagonizer/channels';
import type { DAGHandoff } from '@studnicky/dagonizer/entities';
const channel = new InMemoryChannel();
declare const handoff: DAGHandoff;
// ---cut---
await channel.publish(handoff);
```

Deep-clones `handoff` via `structuredClone`, appends to `published`, then awaits `onPublished`. Errors thrown by `onPublished` are collected in `publishErrors` rather than re-thrown; the envelope is already recorded.

### `onPublished(handoff)` (protected)

Default no-op. Override in a subclass to chain a downstream DAG. Receives the deep-cloned, stored envelope (same instance as the last entry in `published`).

**Extension via subclass, zero callbacks.** The dispatcher calls `channel.publish(handoff)` when a non-embedded flow reaches a terminal bound in `DagonizerOptionsInterface.channels`. The default `onPublished` is a no-op; subclass to restore state and run the continuation:

```ts twoslash
import { InMemoryChannel } from '@studnicky/dagonizer/channels';
import { Dagonizer } from '@studnicky/dagonizer';
import { NodeStateBase } from '@studnicky/dagonizer';
import type { DAGHandoff } from '@studnicky/dagonizer/entities';
class AppState extends NodeStateBase {}
declare const downstreamDispatcher: Dagonizer<AppState>;
// ---cut---
class HandoffChannel extends InMemoryChannel {
  protected override async onPublished(handoff: DAGHandoff): Promise<void> {
    if (!('stateSnapshot' in handoff) || handoff.stateSnapshot == null) return;
    const snapshot = handoff.stateSnapshot as import('@studnicky/dagonizer/entities').JsonObject;
    const state = AppState.restore(snapshot);
    await downstreamDispatcher.execute('continuation-dag', state);
  }
}

const dispatcher = new Dagonizer<AppState>({
  channels: { 'hand-off': new HandoffChannel() },
});
```

---

## Type: `InMemoryChannelOptions`

```ts twoslash
import type { InMemoryChannelOptions } from '@studnicky/dagonizer/channels';
// ---cut---
const _opts: InMemoryChannelOptions = {};
```

Constructor options for `InMemoryChannel`. Currently carries no fields. The type is the extension point for future channel configuration: adding a field here is non-breaking (callers that pass `{}` continue to compile).

---

## Implementing a real transport

Replace `InMemoryChannel` with any class that implements `HandoffChannelInterface`:

```ts twoslash
import type { HandoffChannelInterface } from '@studnicky/dagonizer/contracts';
import type { DAGHandoff } from '@studnicky/dagonizer/entities';
declare const sqsClient: { sendMessage(params: { Body: string }): Promise<void> };
// ---cut---
class SqsChannel implements HandoffChannelInterface {
  async publish(handoff: DAGHandoff): Promise<void> {
    // Never throw: the dispatcher does not catch channel errors.
    try {
      await sqsClient.sendMessage({ Body: JSON.stringify(handoff) });
    } catch (err) {
      // Log and swallow — the envelope payload is pure JSON.
    }
  }
}
```

`HandoffChannelInterface` ships through `@studnicky/dagonizer/contracts`. See [Guide: Distribution and cloud](../guide/distribution) for the serverless handler pattern and `registryVersion` handshake.

---

## Related guides

- [Example 11: Loopback hand-off](../examples/11-handoff)
- [Guide: Distribution and cloud](../guide/distribution)
- [Reference: Contracts](./contracts) — `HandoffChannelInterface`, `MessageHandoffChannelInterface`
- [Reference: Container](./container) — `DagContainerBase`, `DagHost`
