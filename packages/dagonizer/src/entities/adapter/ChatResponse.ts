/**
 * ChatResponse: what the adapter returns for a single chat round-trip.
 *
 * Every field is always present; zero/empty defaults fill absent cases.
 * The JSON-expressible fields are validated at the ingest boundary via
 * `ChatResponseSchema` before the TypeScript type is asserted.
 */

import type { FromSchema } from 'json-schema-to-ts';

import { ChatResponseMessageSchema } from './ChatResponseMessage.js';
import { TokenUsageSchema } from './TokenUsage.js';

/**
 * JSON Schema for `ChatResponse` — the JSON-expressible portion of what the
 * adapter returns. Validates at the JSON-ingest boundary before the
 * TypeScript type is asserted.
 */
export const ChatResponseSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/adapter/ChatResponse',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['message', 'finishReason', 'usage'],
  'properties': {
    'message': ChatResponseMessageSchema,
    'finishReason': { 'type': 'string', 'enum': ['stop', 'length', 'tool_call', 'error'] },
    'usage': TokenUsageSchema,
  },
  'additionalProperties': false,
} as const;

/** What the adapter returns; every field always present. */
export type ChatResponse = FromSchema<typeof ChatResponseSchema>;
