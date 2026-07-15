/** Configurable age policy for historical graph state. */
export type GraphRetentionPolicyType = {
  /** Default minimum age, in milliseconds, before a closed graph is prunable. */
  readonly defaultRetentionMs: number;
  /** Lifecycle-specific overrides for completed/failed/cancelled states. */
  readonly lifecycleRetentionMs?: Readonly<Partial<Record<'completed' | 'failed' | 'cancelled' | 'timed_out', number>>>;
  /** Keep graphs without an explicit closed fact when policy-driven retention is enabled. */
  readonly requireClosed: boolean;
};

export const DEFAULT_GRAPH_RETENTION_POLICY: GraphRetentionPolicyType = {
  'defaultRetentionMs': 0,
  'requireClosed': false,
};
