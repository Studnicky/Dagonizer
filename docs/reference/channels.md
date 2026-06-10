---
seeAlso:
  - text: 'Reference: Contracts'
    link: './contracts'
    description: '`ChannelInterface`, `MessageChannelInterface`'
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

Hand-off channel implementations. Ships through `@noocodex/dagonizer/channels`.

```ts
import { InMemoryChannel } from '@noocodex/dagonizer/channels';
import type { InMemoryChannelOptions } from '@noocodex/dagonizer/channels';
```

---

## Class: `InMemoryChannel`

Local default and loopback `ChannelInterface` implementation. Stores every published `DAGHandoff` envelope in an in-memory array. Deep-clones each envelope on publish via `structuredClone` to ensure full serialization fidelity.

```ts
class InMemoryChannel implements ChannelInterface {
  constructor(options?: InMemoryChannelOptions)
  get published(): readonly DAGHandoff[]
  async publish(handoff: DAGHandoff): Promise<void>
  protected async onPublished(handoff: DAGHandoff): Promise<void>
}
```

### Constructor

```ts
new InMemoryChannel(options?: InMemoryChannelOptions)
```

`InMemoryChannelOptions` carries no fields; the type is the extension point for future channel configuration.

### `published`

```ts
get published(): readonly DAGHandoff[]
```

All envelopes in publish order. Each entry is the deep-cloned, stored copy — independent from the dispatcher's internal state.

### `publish(handoff)`

```ts
async publish(handoff: DAGHandoff): Promise<void>
```

Deep-clones `handoff` via `structuredClone`, appends to `published`, then awaits `onPublished`. Any error thrown by `onPublished` is swallowed; the envelope is already recorded.

### `onPublished(handoff)` (protected)

```ts
protected async onPublished(handoff: DAGHandoff): Promise<void>
```

Default no-op. Override in a subclass to chain a downstream DAG. Receives the deep-cloned, stored envelope (same instance as the last entry in `published`).

**Extension via subclass, zero callbacks.** The dispatcher calls `channel.publish(handoff)` when a non-embedded flow reaches a terminal bound in `DagonizerOptionsInterface.channels`. The default `onPublished` is a no-op; subclass to restore state and run the continuation:

```ts
import { InMemoryChannel } from '@noocodex/dagonizer/channels';
import type { DAGHandoff } from '@noocodex/dagonizer/entities';

class HandoffChannel extends InMemoryChannel {
  protected override async onPublished(handoff: DAGHandoff): Promise<void> {
    if (!('stateSnapshot' in handoff)) return;
    const state = AppState.restore(handoff.stateSnapshot as JsonObject);
    await downstreamDispatcher.execute('continuation-dag', state);
  }
}

const dispatcher = new Dagonizer<AppState>({
  channels: { 'hand-off': new HandoffChannel() },
});
```

---

## Type: `InMemoryChannelOptions`

```ts
type InMemoryChannelOptions = Record<string, never>
```

Constructor options for `InMemoryChannel`. Currently carries no fields. The type is the extension point for future channel configuration: adding a field here is non-breaking (callers that pass `{}` continue to compile).

---

## Implementing a real transport

Replace `InMemoryChannel` with any class that implements `ChannelInterface`:

```ts
import type { ChannelInterface } from '@noocodex/dagonizer/contracts';
import type { DAGHandoff } from '@noocodex/dagonizer/entities';

class SqsChannel implements ChannelInterface {
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

`ChannelInterface` ships through `@noocodex/dagonizer/contracts`. See [Guide: Distribution and cloud](../guide/distribution) for the serverless handler pattern and `registryVersion` handshake.

---

## Related guides

- [Example 11: Loopback hand-off](../examples/11-handoff)
- [Guide: Distribution and cloud](../guide/distribution)
- [Reference: Contracts](./contracts) — `ChannelInterface`, `MessageChannelInterface`
- [Reference: Container](./container) — `DagContainerBase`, `DagHost`
