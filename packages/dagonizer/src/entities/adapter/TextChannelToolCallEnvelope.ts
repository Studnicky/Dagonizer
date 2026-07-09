/**
 * TextChannelToolCallEnvelope: JSON wire shape emitted by text-channel
 * models that encode tool calls inline (Gemini Nano, WebLLM) rather than
 * via a native tool-call channel.
 *
 * The envelope is `{ tool_calls: [{ name, arguments }] }`. The schema is
 * permissive — every field is optional and `additionalProperties` is open —
 * because the body is extracted from surrounding model prose and individual
 * entries may be malformed; `ToolCallCodec.decode` filters structurally
 * invalid entries after validation. Validated once at the foreign boundary
 * via a module-load-compiled `EntityValidatorInterface`; never cast.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const TextChannelToolCallEnvelopeSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer/adapter/TextChannelToolCallEnvelope',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'properties': {
    'tool_calls': {
      'type': 'array',
      'items': {
        'type': 'object',
        'properties': {
          'name': { 'type': 'string' },
          'arguments': { 'type': 'object' },
        },
        'additionalProperties': true,
      },
    },
  },
  'additionalProperties': true,
} as const;

/** TypeScript type derived from `TextChannelToolCallEnvelopeSchema` via `json-schema-to-ts`. */
export type TextChannelToolCallEnvelopeType = FromSchema<typeof TextChannelToolCallEnvelopeSchema>;
