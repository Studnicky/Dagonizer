/**
 * DAGHandoff: wire-safe envelope published after a whole top-level DAG run
 * completes at a terminal placement. Carries the state for cross-host
 * continuation: a receiver restores the envelope state and executes the next
 * DAG in the chain.
 *
 * Exactly one of `stateSnapshot` (by-value) or `stateSnapshotRef` (by-reference
 * URI) is present per envelope. Use `stateSnapshotRef` for size-limited
 * transports where the state is written separately to a store.
 *
 * JSON Schema 2020-12 entity: schema value + FromSchema-derived TypeScript type.
 */

import type { FromSchema } from 'json-schema-to-ts';

const byValueBranch = {
  'type': 'object',
  'required': ['dagName', 'terminalName', 'terminalOutput', 'registryVersion', 'correlationId', 'placementPath', 'stateSnapshot'],
  'properties': {
    'dagName':          { 'type': 'string', 'minLength': 1 },
    'terminalName':     { 'type': 'string', 'minLength': 1 },
    'terminalOutput':   { 'type': 'string' },
    'registryVersion':  { 'type': 'string' },
    'correlationId':    { 'type': 'string', 'minLength': 1 },
    'placementPath':    { 'type': 'array', 'items': { 'type': 'string' } },
    'stateSnapshot':    { 'type': 'object' },
  },
  'additionalProperties': false,
} as const;

const byRefBranch = {
  'type': 'object',
  'required': ['dagName', 'terminalName', 'terminalOutput', 'registryVersion', 'correlationId', 'placementPath', 'stateSnapshotRef'],
  'properties': {
    'dagName':           { 'type': 'string', 'minLength': 1 },
    'terminalName':      { 'type': 'string', 'minLength': 1 },
    'terminalOutput':    { 'type': 'string' },
    'registryVersion':   { 'type': 'string' },
    'correlationId':     { 'type': 'string', 'minLength': 1 },
    'placementPath':     { 'type': 'array', 'items': { 'type': 'string' } },
    'stateSnapshotRef':  { 'type': 'string', 'minLength': 1 },
  },
  'additionalProperties': false,
} as const;

export const DAGHandoffSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/DAGHandoff',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'oneOf': [byValueBranch, byRefBranch],
} as const;

/** TypeScript type derived from `DAGHandoffSchema` via `json-schema-to-ts`. */
export type DAGHandoffType = FromSchema<typeof DAGHandoffSchema>;
