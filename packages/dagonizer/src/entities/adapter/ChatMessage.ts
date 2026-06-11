/**
 * ChatMessage: a single message in a chat-style conversation.
 *
 * Discriminated on `role`:
 *   - `system`, `user`, `assistant`: require `role` + `content`
 *   - `tool`: additionally requires `toolCallId` + `toolName`
 */

import type { FromSchema } from 'json-schema-to-ts';

/**
 * JSON Schema for `ChatMessage` discriminated on `role`.
 *
 * `system`, `user`, and `assistant` messages require only `role` + `content`.
 * `tool` messages additionally require `toolCallId` + `toolName`.
 * This mirrors the `ChatResponseMessageSchema` `oneOf` pattern and avoids
 * forcing tool-only fields onto non-tool message shapes.
 */
export const ChatMessageSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/adapter/ChatMessage',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'oneOf': [
    {
      'type': 'object',
      'required': ['role', 'content'],
      'properties': {
        'role': { 'type': 'string', 'enum': ['system', 'user', 'assistant'] },
        'content': { 'type': 'string' },
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['role', 'content', 'toolCallId', 'toolName'],
      'properties': {
        'role': { 'type': 'string', 'enum': ['tool'] },
        'content': { 'type': 'string' },
        'toolCallId': { 'type': 'string' },
        'toolName': { 'type': 'string' },
      },
      'additionalProperties': false,
    },
  ],
} as const;

/** A single message in a chat-style conversation. */
export type ChatMessage = FromSchema<typeof ChatMessageSchema>;
