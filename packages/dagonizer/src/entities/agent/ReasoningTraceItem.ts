/**
 * ReasoningTraceItem: one `ReasoningStepType` tagged with its position in the
 * producing stream. Streamed items are self-describing — the `ordinal` lets
 * a downstream consumer (a scatter body recording provenance, for example)
 * derive a `wasInformedBy`-style chain from the item alone, with no
 * cross-item state and no dependence on the order items are actually
 * processed in.
 *
 * `ordinal` is assigned once, at emission time, by the single sequential
 * point that produces the stream (`AgentTraceProducer`); it never changes
 * downstream. Chain derivation is `ordinal - 1` for `ordinal > 0`.
 *
 * JSON Schema 2020-12 entity: schema value + FromSchema-derived TypeScript type.
 */

import type { FromSchema } from 'json-schema-to-ts';

import { ReasoningStepSchema } from './ReasoningStep.js';
import type { ReasoningStepType } from './ReasoningStep.js';

/**
 * JSON Schema for `ReasoningTraceItem`: an ordinal-tagged `ReasoningStepType`.
 */
export const ReasoningTraceItemSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/agent/ReasoningTraceItem',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['ordinal', 'step'],
  'properties': {
    'ordinal': { 'type': 'integer', 'minimum': 0 },
    'step':    ReasoningStepSchema,
  },
  'additionalProperties': false,
} as const;

/**
 * A `ReasoningStepType` tagged with its zero-based position in the producing
 * stream, so the chain of `wasInformedBy` links can be derived from the item
 * alone.
 */
export type ReasoningTraceItemType = FromSchema<typeof ReasoningTraceItemSchema>;

/**
 * Static factory for `ReasoningTraceItemType`.
 *
 * @example
 * ```ts
 * const item = ReasoningTraceItem.create(0, ReasoningStep.create({ kind: 'thought', text: 'checking the cache' }));
 * ```
 */
export class ReasoningTraceItem {
  private constructor() { /* static class */ }

  /** Construct a `ReasoningTraceItemType` pairing `ordinal` with `step`. */
  static create(ordinal: number, step: ReasoningStepType): ReasoningTraceItemType {
    return { 'ordinal': ordinal, 'step': step };
  }
}
