/**
 * ValidationResult: result of node configuration validation.
 *
 * `valid` indicates whether validation passed. `errors` contains the
 * list of validation failure messages (empty when `valid` is `true`).
 */

import type { FromSchema } from 'json-schema-to-ts';

export const ValidationResultSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/ValidationResult',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['errors', 'valid'],
  'properties': {
    'errors': { 'type': 'array', 'items': { 'type': 'string' } },
    'valid': { 'type': 'boolean' },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `ValidationResultSchema` via `json-schema-to-ts`. */
export type ValidationResultType = FromSchema<typeof ValidationResultSchema>;
