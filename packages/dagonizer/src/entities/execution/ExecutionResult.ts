/**
 * ExecutionResult: result of a complete flow execution.
 *
 * `cursor` is the name of the next node to run when execution terminated
 * before completing the flow (abort, deadline, node error). It is `null`
 * when the flow ran to completion.
 *
 * `terminalOutcome` carries the outcome a TerminalNode placement declared
 * when the flow exited through one. `null` when the flow exited via a
 * `null` route, an error path, or an abort. The embedded-DAG executor reads
 * this off the inner DAG's result to route the parent placement's
 * `success` / `error` ports; a TerminalNode(failed) inside an inner DAG
 * surfaces as `error` on the parent.
 *
 * `state` is opaque (`{ type: 'object' }`) at the JSON boundary.
 * `ExecutionResultType<TState>` extends this via `Omit<ExecutionResult, 'state'>`
 * and narrows `state` to the concrete `TState` generic.
 */

import type { FromSchema } from 'json-schema-to-ts';

import type { NodeStateInterface } from '../../NodeStateBase.js';
import type { ParkedType } from './Parked.js';

/**
 * JSON Schema 2020-12 definition for `InterruptionInfo`.
 * Structured cancellation telemetry: the node active when the flow was
 * interrupted and the reason discriminant ('abort' | 'timeout'). Clean
 * exits (completed, terminal, configuration error, node throw) are
 * represented by `interruptedAt: null` on `ExecutionResultSchema`.
 */
export const InterruptionInfoSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/InterruptionInfo',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['nodeName', 'reason'],
  'properties': {
    'nodeName': { 'type': 'string', 'minLength': 1 },
    'reason':   { 'type': 'string', 'enum': ['abort', 'timeout'] },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `InterruptionInfoSchema` via `json-schema-to-ts`. */
export type InterruptionInfoType = FromSchema<typeof InterruptionInfoSchema>;

export const ExecutionResultSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/ExecutionResult',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['cursor', 'executedNodes', 'skippedNodes', 'state', 'interruptedAt', 'terminalOutcome'],
  'properties': {
    'cursor': { 'type': ['string', 'null'] },
    'executedNodes': { 'type': 'array', 'items': { 'type': 'string' } },
    'skippedNodes': { 'type': 'array', 'items': { 'type': 'string' } },
    'state': { 'type': 'object' },
    'terminalOutcome': {
      'oneOf': [
        { 'type': 'string', 'enum': ['completed', 'failed'] },
        { 'type': 'null' },
      ],
    },
    'interruptedAt': {
      'oneOf': [
        { 'type': 'null' },
        InterruptionInfoSchema,
      ],
    },
    'parked': {
      'oneOf': [
        { 'type': 'null' },
        {
          'type': 'object',
          'required': ['correlationKey', 'cursor', 'dagName'],
          'properties': {
            'correlationKey': { 'type': 'string' },
            'cursor':         { 'type': 'string', 'minLength': 1 },
            'dagName':        { 'type': 'string', 'minLength': 1 },
          },
          'additionalProperties': false,
        },
      ],
    },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `ExecutionResultSchema` via `json-schema-to-ts`. */
export type ExecutionResultWireType = FromSchema<typeof ExecutionResultSchema>;

/**
 * Result of flow execution.
 *
 * Extends `ExecutionResultWireType` entity via `Omit<ExecutionResultWireType, 'state' | 'terminalOutcome'>`:
 *   - `state` is narrowed from `object` to the concrete `TState` generic
 *   - `terminalOutcome` is widened from optional to required (always set by the engine; null when no terminal hit)
 *
 * `cursor` carries the name of the next node to run when execution
 * terminated before completing the flow (signal aborted, deadline expired,
 * node threw). It is `null` when the flow ran to completion. Use it
 * with `Checkpoint.capture()` to persist a resumable snapshot.
 *
 * `terminalOutcome` is the outcome declared by the `TerminalNode` placement
 * the flow exited through, or `null` when no terminal was hit (null route,
 * error, or abort path).
 */
export type ExecutionResultType<TState extends NodeStateInterface> = Omit<ExecutionResultWireType, 'state' | 'terminalOutcome' | 'interruptedAt' | 'parked'> & {
  'state': TState;
  'terminalOutcome': 'completed' | 'failed' | null;
  'interruptedAt':   InterruptionInfoType | null;
  /** Populated when a node routed to the reserved `'parked'` output. Null otherwise. */
  'parked':          ParkedType | null;
};
