/**
 * ExecutionResult — result of a complete flow execution.
 *
 * `cursor` is the name of the next node to run when execution terminated
 * before completing the flow (abort, deadline, node error). It is `null`
 * when the flow ran to completion.
 *
 * `state` is opaque (`{ type: 'object' }`) at the JSON boundary.
 * `ExecutionResultInterface<TState>` extends this via `Omit<ExecutionResult, 'state'>`
 * and narrows `state` to the concrete `TState` generic.
 */

import type { FromSchema } from 'json-schema-to-ts';

import type { NodeStateInterface } from '../../NodeStateBase.js';

export const ExecutionResultSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/ExecutionResult',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['cursor', 'executedNodes', 'skippedNodes', 'state'],
  'properties': {
    'cursor': { 'type': ['string', 'null'] },
    'executedNodes': { 'type': 'array', 'items': { 'type': 'string' } },
    'skippedNodes': { 'type': 'array', 'items': { 'type': 'string' } },
    'state': { 'type': 'object' },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `ExecutionResultSchema` via `json-schema-to-ts`. */
export type ExecutionResult = FromSchema<typeof ExecutionResultSchema>;

/**
 * Result of flow execution.
 *
 * Extends `ExecutionResult` entity via `Omit<ExecutionResult, 'state'>`:
 *   - `state` is narrowed from `object` to the concrete `TState` generic
 *
 * `cursor` carries the name of the next node to run when execution
 * terminated before completing the flow (signal aborted, deadline expired,
 * node threw). It is `null` when the flow ran to completion. Use it
 * with `Checkpoint.from()` to persist a resumable snapshot.
 */
export interface ExecutionResultInterface<TState extends NodeStateInterface>
  extends Omit<ExecutionResult, 'state'> {
  'state': TState;
}
