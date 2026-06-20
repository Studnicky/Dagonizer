/**
 * LlmModel: describes a single model available from a provider.
 *
 * Consumers call `Validator.llmModel.is(x)` or `Validator.llmModel.validate(x)`.
 * `variant` distinguishes chat models from embedding models from
 * models whose surface the adapter could not determine.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const LlmModelSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/adapter/LlmModel',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['name', 'variant', 'cloud'],
  'properties': {
    'name':    { 'type': 'string', 'minLength': 1 },
    'variant': { 'type': 'string', 'enum': ['chat', 'embedding', 'unknown'] },
    'cloud':   { 'type': 'boolean' },
  },
  'additionalProperties': false,
} as const;

/** A model descriptor returned by `listModels()`. */
export type LlmModelType = FromSchema<typeof LlmModelSchema>;
