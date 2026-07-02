---
'@studnicky/dagonizer': major
---

`DAGLifecycleMachine` now builds on `@studnicky/fsm`'s `StateMachine` instead of a hand-rolled reducer. The lifecycle transition logic lives on `DAGLifecycleMachineReducer`, a real `StateMachine<DAGLifecycleStateType, DAGLifecycleEventType, never>` subclass whose `reduce()` throws for terminal-state stickiness and illegal active-state transitions instead of returning the input state by reference. `DAGLifecycleMachine` is a thin static facade over one module-level `DAGLifecycleMachineReducer` singleton, matching the `Clock`/`Scheduler` static-facade pattern; `initial()`, `transition()`, `isTerminal()`, and `isParked()` keep their existing signatures and call sites. `NodeStateBase.#dispatch` now catches the thrown transition error and re-throws the same `DAGError` message it always has, so no behavior is visible to consumers of `NodeStateBase`.

`package.json` gains `@studnicky/fsm` as a dependency.
