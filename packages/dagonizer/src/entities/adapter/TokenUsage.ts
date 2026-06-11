/**
 * TokenUsage: token consumption reported by the model provider.
 *
 * Always present; zero when the provider doesn't report.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const TokenUsageSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/adapter/TokenUsage',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['promptTokens', 'completionTokens'],
  'properties': {
    'promptTokens': { 'type': 'number', 'minimum': 0 },
    'completionTokens': { 'type': 'number', 'minimum': 0 },
  },
  'additionalProperties': false,
} as const;

/** Token usage. Always present; zero when the provider doesn't report. */
export type TokenUsage = FromSchema<typeof TokenUsageSchema>;
