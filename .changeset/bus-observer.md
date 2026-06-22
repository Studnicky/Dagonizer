---
"@studnicky/dagonizer": minor
---
BusObserver: bridges Dagonizer lifecycle hooks (via the observers option) to an
EventBus topic. Construct with (bus, topic); pass in DagonizerOptionsType.observers[].
Every lifecycle event is published as a DagLifecycleEventType payload. Pairs with
SseStream to stream pipeline progress to HTTP clients.
