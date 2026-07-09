/**
 * ChatStreamChunk: one incremental delta emitted while a model response
 * streams in.
 *
 * A streaming adapter yields a sequence of these; `delta` is the text
 * fragment produced since the previous chunk. Consumers concatenate
 * `delta` values in emission order to reconstruct the full response text.
 */

import type { FromSchema } from 'json-schema-to-ts';

/**
 * JSON Schema for `ChatStreamChunk`. Validates a single streamed text delta.
 */
export const ChatStreamChunkSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer/adapter/ChatStreamChunk',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['delta'],
  'properties': { 'delta': { 'type': 'string' } },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `ChatStreamChunkSchema` via `json-schema-to-ts`. */
export type ChatStreamChunkType = FromSchema<typeof ChatStreamChunkSchema>;

/**
 * Static factory for `ChatStreamChunkType`.
 *
 * @example
 * ```ts
 * yield ChatStreamChunk.create('Hello');
 * ```
 */
export class ChatStreamChunk {
  private constructor() { /* static class */ }

  /**
   * Construct a `ChatStreamChunkType` from a single text delta.
   *
   * @param delta - The text fragment produced since the previous chunk.
   */
  static create(delta: string): ChatStreamChunkType {
    return { delta };
  }
}
