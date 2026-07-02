---
'@studnicky/dagonizer': major
---

`@studnicky/dagonizer/progress`'s `EventBus` now extends `@studnicky/event-bus`'s `EventBus` instead of a hand-rolled synchronous pub/sub map. Every topic carries a `BusEventEnvelopeType<unknown>` payload; `publish(topic, payload)` wraps the payload in an envelope and delegates to the inherited typed async pub/sub, so `publish` and `subscribe`'s `close`/`drain` all return `Promise<void>`. Delivery goes through a per-subscriber `BusQueue` — a bounded FIFO with a high-water mark — so a slow subscriber's `publish()` call applies backpressure (the returned promise stays pending until the queue has room) instead of delivering synchronously with no bound.

`EventBus.of()` replaces `new EventBus()` (the base class's constructor is `protected`, matching the `@studnicky/event-bus` factory convention). `EventBus.dispose()` is renamed `close()` (async, matching the base class). `EventBus.clear(topic)` is removed — unsubscribe the individual handlers returned by `subscribe()` instead; there is no bulk per-topic clear on the substrate base class.

`BusObserver`'s lifecycle hooks (`onFlowStart`, `onNodeStart`, etc.) stay synchronous per `DispatcherObserverType`; each now fires a fire-and-forget `bus.publish(...)` rather than a synchronous delivery.

`BroadcastChannelRelay`'s inbound handler now awaits the republish before releasing its `#suppressOutbound` echo-suppression flag, so every subscriber queue (including the relay's own outbound subscription) observes the flag before it resets.

`package.json` gains `@studnicky/event-bus` as a dependency.
