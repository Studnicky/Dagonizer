/**
 * RecommendedWorkerCountConfig: configuration entity for SystemInfoInterface.
 *
 * JSON Schema 2020-12 entity following the NodeContext pattern:
 * schema value + FromSchema-derived TypeScript type.
 *
 * All fields required in the schema; module-level defaults fill sentinel
 * values so producers never leave fields absent.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const RecommendedWorkerCountConfigSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer/RecommendedWorkerCountConfig',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['maximumWorkers', 'mainThreadReservation', 'minimumWorkerCount', 'memoryPerWorkerBytes'],
  'properties': {
    'maximumWorkers':        { 'type': 'number' },
    'mainThreadReservation': { 'type': 'number' },
    'minimumWorkerCount':    { 'type': 'number' },
    'memoryPerWorkerBytes':  { 'type': ['number', 'null'] },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `RecommendedWorkerCountConfigSchema` via `json-schema-to-ts`. */
export type RecommendedWorkerCountConfigType = FromSchema<typeof RecommendedWorkerCountConfigSchema>;

/** Default for `mainThreadReservation`: reserve 1 thread for the main thread. */
export const RECOMMENDED_WORKER_COUNT_MAIN_THREAD_RESERVATION = 1;

/** Default for `minimumWorkerCount`: floor the pool at 1 worker. */
export const RECOMMENDED_WORKER_COUNT_MINIMUM = 1;

/** Default for `memoryPerWorkerBytes`: no memory-based cap (null). */
export const RECOMMENDED_WORKER_COUNT_MEMORY_PER_WORKER_BYTES: null = null;

/**
 * Canonical default RecommendedWorkerCountConfig.
 * Producers pass this (spread + override) to fill all required fields.
 */
export const RecommendedWorkerCountConfigDefault: RecommendedWorkerCountConfigType = {
  'maximumWorkers':        1,
  'mainThreadReservation': RECOMMENDED_WORKER_COUNT_MAIN_THREAD_RESERVATION,
  'minimumWorkerCount':    RECOMMENDED_WORKER_COUNT_MINIMUM,
  'memoryPerWorkerBytes':  RECOMMENDED_WORKER_COUNT_MEMORY_PER_WORKER_BYTES,
} as const satisfies RecommendedWorkerCountConfigType;
