/**
 * LlmModel: describes a single model available from a provider.
 *
 * Consumers call `Validator.llmModel.is(x)` or `Validator.llmModel.validate(x)`.
 * `variant` distinguishes chat models from embedding models from
 * models whose surface the adapter could not determine.
 *
 * `costRank` is a non-negative relative cost figure where LOWER means
 * cheaper. It is comparable ONLY within a single provider's catalogue —
 * each adapter populates it from the best cost signal it has (OpenRouter
 * token pricing, Ollama on-disk size, or the `ModelCost` name heuristic),
 * so `selectChatModel` can pick the cheapest available model when a
 * configured default is absent. Never compare a rank across providers.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const LlmModelSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer/adapter/LlmModel',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['name', 'variant', 'cloud', 'costRank'],
  'properties': {
    'name':     { 'type': 'string', 'minLength': 1 },
    'variant':  { 'type': 'string', 'enum': ['chat', 'embedding', 'unknown'] },
    'cloud':    { 'type': 'boolean' },
    'costRank': { 'type': 'number', 'minimum': 0 },
  },
  'additionalProperties': false,
} as const;

/** A model descriptor returned by `listModels()`. */
export type LlmModelType = FromSchema<typeof LlmModelSchema>;
