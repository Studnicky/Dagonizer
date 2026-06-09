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
  'type': 'object' as const,
  'required': ['dagName', 'terminalName', 'terminalOutput', 'registryVersion', 'correlationId', 'placementPath', 'stateSnapshot'] as const,
  'properties': {
    'dagName':          { 'type': 'string' as const, 'minLength': 1 },
    'terminalName':     { 'type': 'string' as const, 'minLength': 1 },
    'terminalOutput':   { 'type': 'string' as const },
    'registryVersion':  { 'type': 'string' as const },
    'correlationId':    { 'type': 'string' as const, 'minLength': 1 },
    'placementPath':    { 'type': 'array' as const, 'items': { 'type': 'string' as const } },
    'stateSnapshot':    { 'type': 'object' as const },
  },
  'additionalProperties': false as const,
};

const byRefBranch = {
  'type': 'object' as const,
  'required': ['dagName', 'terminalName', 'terminalOutput', 'registryVersion', 'correlationId', 'placementPath', 'stateSnapshotRef'] as const,
  'properties': {
    'dagName':           { 'type': 'string' as const, 'minLength': 1 },
    'terminalName':      { 'type': 'string' as const, 'minLength': 1 },
    'terminalOutput':    { 'type': 'string' as const },
    'registryVersion':   { 'type': 'string' as const },
    'correlationId':     { 'type': 'string' as const, 'minLength': 1 },
    'placementPath':     { 'type': 'array' as const, 'items': { 'type': 'string' as const } },
    'stateSnapshotRef':  { 'type': 'string' as const, 'minLength': 1 },
  },
  'additionalProperties': false as const,
};

export const DAGHandoffSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/DAGHandoff',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'oneOf': [byValueBranch, byRefBranch],
} as const;

/** TypeScript type derived from `DAGHandoffSchema` via `json-schema-to-ts`. */
export type DAGHandoff = FromSchema<typeof DAGHandoffSchema>;
