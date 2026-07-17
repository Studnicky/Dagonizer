/** Post-completion host-side projection and durability write points. */
export type WritePointType =
  | 'NodeEdges'
  | 'FullItemProjection'
  | 'FoldDeltaJournal'
  | 'WatermarkCommit'
  | 'InMemorySnapshot';

/** Allowed write-point enum values. */
export const WRITE_POINTS = [
  'NodeEdges',
  'FullItemProjection',
  'FoldDeltaJournal',
  'WatermarkCommit',
  'InMemorySnapshot',
] as const satisfies readonly WritePointType[];

/** Runtime default write-point policy. */
export const DEFAULT_WRITE_POINTS: readonly WritePointType[] = [
  'NodeEdges',
  'WatermarkCommit',
];

/** Shared JSON Schema for explicit write-point arrays. */
export const WritePointsSchema = {
  'type': 'array',
  'items': {
    'type': 'string',
    'enum': WRITE_POINTS,
  },
} as const;
