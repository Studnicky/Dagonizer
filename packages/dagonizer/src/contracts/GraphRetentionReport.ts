/** Result of evaluating or applying a graph-retention plan. */
export type GraphRetentionReportType = {
  readonly consideredGraphIris: readonly string[];
  readonly prunableGraphIris: readonly string[];
  readonly retainedGraphIris: readonly string[];
  readonly removedQuadCount: number;
};
