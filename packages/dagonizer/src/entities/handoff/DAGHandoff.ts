/** Plain transient-state handoff published after a top-level DAG run. */

import type { FromSchema } from 'json-schema-to-ts';

import { TransientNodeStateSchema } from '../executor/TransientNodeState.js';
import type { TransientNodeStateType } from '../executor/TransientNodeState.js';

export const DAGHandoffSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer/DAGHandoff',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['dagName', 'terminalName', 'terminalOutput', 'registryVersion', 'correlationId', 'placementPath', 'graphState'],
  'properties': {
    'dagName':          { 'type': 'string', 'minLength': 1 },
    'terminalName':    { 'type': 'string', 'minLength': 1 },
    'terminalOutput':  { 'type': 'string' },
    'registryVersion': { 'type': 'string' },
    'correlationId':   { 'type': 'string', 'minLength': 1 },
    'placementPath':   { 'type': 'array', 'items': { 'type': 'string' } },
    'graphState': TransientNodeStateSchema,
  },
  'additionalProperties': false,
} as const;

export type DAGHandoffType = Omit<FromSchema<typeof DAGHandoffSchema>, 'graphState'> & {
  graphState: TransientNodeStateType;
};
