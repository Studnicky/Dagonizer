/**
 * ReasoningStep: one step of an agent's reasoning trace, expressed as a
 * discriminated union.
 *
 *   thought:     the agent's internal deliberation text.
 *   action:      the agent invokes a named tool with a set of arguments.
 *   observation: the result returned by a previously invoked tool.
 *   final:       the agent's terminal answer; no further steps follow.
 */

import type { FromSchema } from 'json-schema-to-ts';

/**
 * JSON Schema for `ReasoningStep` discriminated union. Validates the
 * JSON-expressible fields of one step in an agent's reasoning trace.
 */
export const ReasoningStepSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/agent/ReasoningStep',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'oneOf': [
    {
      'type': 'object',
      'required': ['kind', 'text'],
      'properties': { 'kind': { 'const': 'thought' }, 'text': { 'type': 'string' } },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['kind', 'tool', 'args'],
      'properties': {
        'kind': { 'const': 'action' },
        'tool': { 'type': 'string' },
        'args': { 'type': 'object' },
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['kind', 'output'],
      'properties': { 'kind': { 'const': 'observation' }, 'output': { 'type': 'string' } },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['kind', 'text'],
      'properties': { 'kind': { 'const': 'final' }, 'text': { 'type': 'string' } },
      'additionalProperties': false,
    },
  ],
} as const;

/**
 * One step of an agent's reasoning trace, expressed as a discriminated
 * union so every shape is monomorphic.
 *
 *   thought: the agent's internal deliberation text.
 *   action: the agent invokes a named tool with a set of arguments.
 *   observation: the result returned by a previously invoked tool.
 *   final: the agent's terminal answer; no further steps follow.
 */
export type ReasoningStepType = FromSchema<typeof ReasoningStepSchema>;

/**
 * Static factory for `ReasoningStepType`. One named constructor per variant
 * so callers never hand-assemble the discriminant.
 *
 * @example
 * ```ts
 * steps.push(ReasoningStepBuilder.thought('checking the cache first'));
 * steps.push(ReasoningStepBuilder.action('cacheLookup', { key: 'user:42' }));
 * steps.push(ReasoningStepBuilder.observation('cache miss'));
 * steps.push(ReasoningStepBuilder.final('the user is not cached'));
 * ```
 */
export class ReasoningStepBuilder {
  private constructor() { /* static class */ }

  /** Construct a `thought` step. */
  static thought(text: string): ReasoningStepType {
    return { 'kind': 'thought', 'text': text };
  }

  /** Construct an `action` step invoking `tool` with `args`. */
  static action(tool: string, args: Record<string, unknown>): ReasoningStepType {
    return { 'kind': 'action', 'tool': tool, 'args': args };
  }

  /** Construct an `observation` step carrying tool `output`. */
  static observation(output: string): ReasoningStepType {
    return { 'kind': 'observation', 'output': output };
  }

  /** Construct a `final` step carrying the agent's terminal answer. */
  static final(text: string): ReasoningStepType {
    return { 'kind': 'final', 'text': text };
  }
}
