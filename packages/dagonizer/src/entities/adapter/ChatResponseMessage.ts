/**
 * ChatResponseMessage: the model's response expressed as a discriminated union.
 *
 *   text:  pure prose — `content` is the message body, no tools called.
 *   tools: model emitted one or more tool calls; no prose with them.
 *   mixed: model emitted both prose and tool calls.
 *
 * References `ToolCallSchema` from `./ToolCall.ts` — schemas are co-located
 * so the inlined `items` reference is still a compile-time constant.
 */

import type { FromSchema } from 'json-schema-to-ts';

import { ToolCallSchema } from './ToolCall.js';

/**
 * JSON Schema for `ChatResponseMessage` discriminated union. Validates the
 * JSON-expressible fields of what a provider returns (text, tools, or mixed).
 */
export const ChatResponseMessageSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/adapter/ChatResponseMessage',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'oneOf': [
    {
      'type': 'object',
      'required': ['variant', 'content'],
      'properties': { 'variant': { 'const': 'text' }, 'content': { 'type': 'string' } },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['variant', 'toolCalls'],
      'properties': {
        'variant': { 'const': 'tools' },
        'toolCalls': { 'type': 'array', 'items': ToolCallSchema },
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['variant', 'content', 'toolCalls'],
      'properties': {
        'variant': { 'const': 'mixed' },
        'content': { 'type': 'string' },
        'toolCalls': { 'type': 'array', 'items': ToolCallSchema },
      },
      'additionalProperties': false,
    },
  ],
} as const;

/**
 * The model's response, expressed as a discriminated union so every
 * shape is monomorphic.
 *
 *   text: pure prose. `content` is the message body, no tools called.
 *   tools: model emitted one or more tool calls; no prose with them.
 *   mixed: model emitted both prose and tool calls.
 */
export type ChatResponseMessageType = FromSchema<typeof ChatResponseMessageSchema>;
