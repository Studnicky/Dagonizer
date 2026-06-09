/**
 * NodeOutput: result returned by a DAG node.
 *
 * The `output` field is the named port used to route to the next node.
 * Errors are collected and forwarded to state; they do not stop execution.
 *
 * The NodeError shape is inlined here (same approach used by DAGSchema
 * which inlines GatherConfig). Standalone NodeErrorSchema is authoritative for
 * that shape; this is a structural copy to avoid $ref resolution at compile time.
 */

import type { FromSchema } from 'json-schema-to-ts';

import type { NodeErrorInterface } from './NodeError.js';

export const NodeOutputSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/NodeOutput',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['output'],
  'properties': {
    'output': { 'type': 'string' },
    'errors': {
      'type': 'array',
      'items': {
        'type': 'object',
        'required': ['code', 'message', 'operation', 'recoverable', 'timestamp'],
        'properties': {
          'code': { 'type': 'string' },
          'context': { 'type': 'object' },
          'message': { 'type': 'string' },
          'operation': { 'type': 'string' },
          'recoverable': { 'type': 'boolean' },
          'timestamp': { 'type': 'string' },
        },
        'additionalProperties': false,
      },
    },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `NodeOutputSchema` via `json-schema-to-ts`. */
export type NodeOutput = FromSchema<typeof NodeOutputSchema>;

/**
 * Result returned by a DAG node.
 * Determines routing to next stage(s).
 *
 * Extends `NodeOutput` entity via `Omit<NodeOutput, 'output' | 'errors'>`:
 *   - `output` is narrowed from `string` to `TOutput`
 *   - `errors` is narrowed from the entity's inlined shape to `NodeErrorInterface[]`
 *     (which carries a narrowed `context: Record<string, unknown>`)
 */
export interface NodeOutputInterface<TOutput extends string = string>
  extends Omit<NodeOutput, 'errors' | 'output'> {
  /**
   * Optional errors to collect in state.
   * Errors are accumulated, not thrown.
   * At flow completion, caller decides what to do with collected errors.
   *
   * Kept optional on this author-facing interface: the engine normalises
   * absent `errors` to `[]` at the node-return boundary, so internal
   * handling never null-checks the field. Node authors omit it when
   * there are no errors to report; the engine supplies the default.
   */
  'errors'?: NodeErrorInterface[];

  /**
   * Named output port to route to.
   * Must be one of the node's declared outputs.
   * Examples: 'success', 'error', 'retry', 'skip', 'partial'
   */
  'output': TOutput;
}
