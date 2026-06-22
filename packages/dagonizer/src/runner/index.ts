/**
 * Runner barrel: re-exports all public runner surface.
 *
 * Public surface for `@studnicky/dagonizer/runner`:
 *   - `DagRunner` + `DagRunnerInterface` + `DagRunnerOptionsType` — abstract base
 *   - `OnceTrigger`     — single-invocation trigger
 *   - `CliTrigger`      — CLI command + parsed-args trigger (abstract)
 *   - `EventTrigger`    — subscription-based per-message trigger (abstract)
 *   - `RequestTrigger`  — per-HTTP-turn trigger (abstract)
 *
 * The `TriggerInterface` adapter contract ships through `./contracts` (its
 * canonical source); re-exported here for ergonomic co-import with the runner.
 */

export type { DagRunnerInterface, DagRunnerOptionsType } from './DagRunner.js';
export { DagRunner } from './DagRunner.js';

export { OnceTrigger } from './OnceTrigger.js';
export { CliTrigger } from './CliTrigger.js';
export { EventTrigger } from './EventTrigger.js';
export { RequestTrigger } from './RequestTrigger.js';

// Re-export the trigger contract for ergonomic co-import.
export type { TriggerInterface } from '../contracts/TriggerInterface.js';
