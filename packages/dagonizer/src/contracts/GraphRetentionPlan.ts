/** Catalog-driven graph-retention policy; protected graphs cannot be pruned. */
import type { GraphRetentionPolicyType } from './GraphRetentionPolicy.js';

export type GraphRetentionPlanType = {
  /** Optional administrative scope; omitted means the graph catalog is authoritative. */
  readonly graphIris?: readonly string[];
  /** Optional additional roots; semantic protection facts are always discovered. */
  readonly protectedGraphIris?: readonly string[];
  /** Durable semantic/memory graphs are never pruned by this plan. */
  readonly durableGraphIris?: readonly string[];
  /** Graphs required by live checkpoints or external references are protected. */
  readonly referencedGraphIris?: readonly string[];
  readonly liveCheckpointGraphIris?: readonly string[];
  readonly dryRun?: boolean;
  readonly retentionPolicy?: Partial<GraphRetentionPolicyType>;
  readonly now?: string;
};
