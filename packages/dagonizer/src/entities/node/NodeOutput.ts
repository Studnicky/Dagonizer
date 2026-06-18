/**
 * NodeOutput: result returned by a DAG node.
 *
 * The `output` field is the named port used to route to the next node.
 * Errors are collected and forwarded to state; they do not stop execution.
 *
 * The NodeError item shape references the single-source `NodeErrorProperties`
 * const and `NodeErrorSchema.required` from `NodeError.ts` structurally;
 * `json-schema-to-ts` reads the literal at compile time, so the derived type is
 * identical to an inline copy while field changes propagate from one place.
 *
 * Both `errors` (on NodeOutput) and `context` (on each error item) are
 * required — always present, no optional fields, one hidden class per shape.
 * V8 monomorphic.
 *
 * `NodeOutputBuilder.of(output, options?)` is the construction factory.
 * It fills `errors: []` by default so node authors never write boilerplate.
 */

import type { FromSchema } from 'json-schema-to-ts';

import { NodeErrorProperties, NodeErrorSchema } from './NodeError.js';
import type { NodeErrorInterface } from './NodeError.js';

export const NodeOutputSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/NodeOutput',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['errors', 'output'],
  'properties': {
    'output': { 'type': 'string' },
    'errors': {
      'type': 'array',
      'items': {
        'type': 'object',
        'required': NodeErrorSchema.required,
        'properties': NodeErrorProperties,
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
 *
 * `errors` is required — always present. `NodeOutputBuilder.of` fills `errors: []`
 * by default so authors never write boilerplate.
 */
export interface NodeOutputInterface<TOutput extends string = string>
  extends Omit<NodeOutput, 'errors' | 'output'> {
  /**
   * Errors to collect in state. Always present; empty when the node reports no errors.
   * Errors are accumulated, not thrown.
   * At flow completion, caller decides what to do with collected errors.
   */
  'errors': NodeErrorInterface[];

  /**
   * Named output port to route to.
   * Must be one of the node's declared outputs.
   * Examples: 'success', 'error', 'retry', 'skip', 'partial'
   */
  'output': TOutput;
}

/**
 * Static factory for `NodeOutputInterface`.
 *
 * Named `NodeOutputBuilder` to avoid the identifier collision with the
 * schema-derived `NodeOutput` type (per the canonical-names rule: when a
 * type and a value share a name, rename the value to its real role).
 *
 * `NodeOutputBuilder.of(output, options?)` constructs a complete result with
 * `errors: []` by default so node authors need not write `errors: []`
 * explicitly when returning a clean result.
 */
export class NodeOutputBuilder {
  private constructor() { /* static class */ }

  /**
   * Construct a `NodeOutputInterface` with `errors` defaulting to `[]`.
   *
   * @example
   * ```ts
   * return NodeOutputBuilder.of('success');
   * return NodeOutputBuilder.of('error', { errors: [NodeErrorBuilder.from('CODE', 'msg', 'op', false, new Date().toISOString())] });
   * ```
   */
  static of<TOutput extends string>(
    output: TOutput,
    options: { errors?: NodeErrorInterface[] } = {},
  ): NodeOutputInterface<TOutput> {
    return { output, 'errors': options.errors ?? [] };
  }
}
