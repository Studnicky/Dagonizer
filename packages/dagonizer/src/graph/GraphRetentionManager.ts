import type { GraphDatasetInterface } from '../contracts/GraphDatasetInterface.js';
import type { GraphRetentionPlanType } from '../contracts/GraphRetentionPlan.js';
import { DEFAULT_GRAPH_RETENTION_POLICY, type GraphRetentionPolicyType } from '../contracts/GraphRetentionPolicy.js';
import type { GraphRetentionReportType } from '../contracts/GraphRetentionReport.js';

import { DagGraphTerms } from './DagGraphTerms.js';
import { GraphRetentionQueryService } from './GraphRetentionQueryService.js';
import { GraphStateTerms } from './GraphStateTerms.js';

/** Applies explicit, checkpoint-aware named-graph retention decisions. */
export class GraphRetentionManager {
  readonly #dataset: GraphDatasetInterface;
  readonly #queries: GraphRetentionQueryService;

  readonly #policy: GraphRetentionPolicyType;

  constructor(dataset: GraphDatasetInterface, policy: GraphRetentionPolicyType = DEFAULT_GRAPH_RETENTION_POLICY) {
    this.#dataset = dataset;
    this.#queries = new GraphRetentionQueryService(dataset);
    this.#policy = policy;
  }

  evaluate(plan: GraphRetentionPlanType): GraphRetentionReportType {
    const graphIris = plan.graphIris === undefined || plan.graphIris.length === 0
      ? [...this.#queries.graphIris()]
      : [...plan.graphIris];
    const policy: GraphRetentionPolicyType = { ...this.#policy, ...plan.retentionPolicy };
    const eligible = this.#queries.eligibleGraphIris(graphIris, policy, plan.now ?? new Date().toISOString());
    const protectedGraphs = new Set([
      ...(plan.protectedGraphIris ?? []),
      ...(plan.durableGraphIris ?? []),
      ...(plan.referencedGraphIris ?? []),
      ...(plan.liveCheckpointGraphIris ?? []),
      ...this.#queries.protectedClosure(),
      ...this.#queries.openGraphIris(),
    ]);
    const prunableGraphIris = graphIris.filter((graphIri) => eligible.has(graphIri) && !protectedGraphs.has(graphIri));
    const retainedGraphIris = graphIris.filter((graphIri) => !eligible.has(graphIri) || protectedGraphs.has(graphIri));
    const removedQuadCount = prunableGraphIris.reduce((count, graphIri) => count + this.#dataset.count({ "graph": DagGraphTerms.namedNode(graphIri) }), 0);
    return { "consideredGraphIris": graphIris, prunableGraphIris, retainedGraphIris, removedQuadCount };
  }

  apply(plan: GraphRetentionPlanType): GraphRetentionReportType {
    const report = this.evaluate(plan);
    if (plan.dryRun === true) return report;
    this.#dataset.transact((dataset) => {
      for (const graphIri of report.prunableGraphIris) dataset.clearGraph(DagGraphTerms.namedNode(graphIri));
    });
    return report;
  }

  compactRun(runIri: string, closedAt = new Date().toISOString()): GraphRetentionReportType {
    const graphIri = GraphStateTerms.runGraphIri(runIri);
    return this.compactGraph(graphIri, GraphStateTerms.summaryGraphIri(graphIri), runIri, closedAt);
  }

  compactGraph(sourceGraphIri: string, summaryGraphIri: string, resourceIri: string, closedAt = new Date().toISOString()): GraphRetentionReportType {
    const sourceQuadCount = this.#dataset.count({ "graph": DagGraphTerms.namedNode(sourceGraphIri) });
    const graph = DagGraphTerms.namedNode(sourceGraphIri);
    const summaryGraph = DagGraphTerms.namedNode(summaryGraphIri);
    const resource = DagGraphTerms.namedNode(resourceIri);
    const activity = DagGraphTerms.namedNode(`${summaryGraphIri}/activity/${encodeURIComponent(closedAt)}`);
    this.#dataset.transact((dataset) => dataset.add([
      { "subject": activity, "predicate": DagGraphTerms.namedNode(DagGraphTerms.RDF_TYPE), "object": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.CompactionActivity), "graph": summaryGraph },
      { "subject": activity, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.CompactsGraph), "object": graph, "graph": summaryGraph },
      { "subject": resource, "predicate": DagGraphTerms.namedNode(DagGraphTerms.RDF_TYPE), "object": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.CompactedRun), "graph": summaryGraph },
      { "subject": resource, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.SourceGraph), "object": graph, "graph": summaryGraph },
      { "subject": resource, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.GraphStatus), "object": DagGraphTerms.literal(GraphStateTerms.DAGONIZER.Closed), "graph": summaryGraph },
      { "subject": resource, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.ClosedAt), "object": DagGraphTerms.literal(closedAt), "graph": summaryGraph },
      { "subject": resource, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.QuadCount), "object": DagGraphTerms.literal(String(sourceQuadCount)), "graph": summaryGraph },
    ]));
    return this.apply({ "graphIris": [sourceGraphIri], "protectedGraphIris": [summaryGraphIri], "retentionPolicy": { "defaultRetentionMs": 0, "requireClosed": false } });
  }

}
