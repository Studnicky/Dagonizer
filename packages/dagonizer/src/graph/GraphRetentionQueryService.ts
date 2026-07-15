import type { GraphDatasetInterface } from '../contracts/GraphDatasetInterface.js';
import type { GraphRetentionPolicyType } from '../contracts/GraphRetentionPolicy.js';

import { DagGraphTerms } from './DagGraphTerms.js';
import { GraphStateTerms } from './GraphStateTerms.js';

/** Queries graph lifecycle, retention, and dependency facts for compaction. */
export class GraphRetentionQueryService {
  readonly #dataset: GraphDatasetInterface;

  constructor(dataset: GraphDatasetInterface) {
    this.#dataset = dataset;
  }

  graphIris(): readonly string[] {
    const graphs = new Set<string>();
    for (const quad of this.#dataset.triples()) {
      if (quad.graph.termType === 'NamedNode') graphs.add(quad.graph.value);
    }
    return [...graphs];
  }

  protectedClosure(explicit: readonly string[] = []): ReadonlySet<string> {
    const protectedGraphs = new Set(explicit);
    const edges = new Map<string, Set<string>>();
    for (const quad of this.#dataset.triples()) {
      if (quad.predicate.termType !== 'NamedNode') continue;
      const predicate = quad.predicate.value;
      if (quad.object.termType === 'NamedNode'
        && (predicate === GraphStateTerms.DAGONIZER.ProtectsGraph || predicate === GraphStateTerms.DAGONIZER.ReferencesGraph)) {
        protectedGraphs.add(quad.object.value);
      }
      if (quad.subject.termType === 'NamedNode' && quad.object.termType === 'NamedNode'
        && (predicate === GraphStateTerms.DAGONIZER.ProtectsGraph || predicate === GraphStateTerms.DAGONIZER.ReferencesGraph
          || predicate === GraphStateTerms.DAGONIZER.SourceGraph || predicate === GraphStateTerms.DAGONIZER.CompactsGraph)) {
        const targets = edges.get(quad.subject.value) ?? new Set<string>();
        targets.add(quad.object.value);
        edges.set(quad.subject.value, targets);
      }
      if (predicate === GraphStateTerms.DAGONIZER.RetentionClass && quad.object.termType === 'NamedNode'
        && quad.object.value === GraphStateTerms.DAGONIZER.Durable && quad.subject.termType === 'NamedNode') protectedGraphs.add(quad.subject.value);
    }
    const queue = [...protectedGraphs];
    let readIndex = 0;
    while (readIndex < queue.length) {
      const current = queue[readIndex++];
      if (current === undefined) continue;
      for (const target of edges.get(current) ?? []) {
        if (protectedGraphs.has(target)) continue;
        protectedGraphs.add(target);
        queue.push(target);
      }
    }
    return protectedGraphs;
  }

  openGraphIris(): ReadonlySet<string> {
    const open = new Set<string>();
    const catalogued = new Set<string>();
    for (const quad of this.#dataset.triples()) {
      if (quad.graph.termType !== 'NamedNode' || quad.predicate.termType !== 'NamedNode') continue;
      if (quad.subject.termType === 'NamedNode' && quad.subject.value === quad.graph.value
        && quad.predicate.value === DagGraphTerms.RDF_TYPE && quad.object.termType === 'NamedNode'
        && quad.object.value === GraphStateTerms.DAGONIZER.RunDetail) catalogued.add(quad.graph.value);
      if (quad.predicate.value === GraphStateTerms.DAGONIZER.GraphStatus
        && (quad.object.termType !== 'NamedNode' || quad.object.value !== GraphStateTerms.DAGONIZER.Closed)) open.add(quad.graph.value);
      if (quad.predicate.value === GraphStateTerms.DAGONIZER.LifecycleVariant
        && quad.object.termType === 'NamedNode'
        && (quad.object.value === GraphStateTerms.lifecycleVariantIri('running')
          || quad.object.value === GraphStateTerms.lifecycleVariantIri('awaiting-input'))) open.add(quad.graph.value);
    }
    for (const graphIri of catalogued) {
      if (!this.#dataset.ask({ "subject": DagGraphTerms.namedNode(graphIri), "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.ClosedAt), "graph": DagGraphTerms.namedNode(graphIri) })) open.add(graphIri);
    }
    return open;
  }

  eligibleGraphIris(graphIris: readonly string[], policy: GraphRetentionPolicyType, now: string): ReadonlySet<string> {
    const cutoff = Date.parse(now);
    const eligible = new Set<string>();
    for (const graphIri of graphIris) {
      const graph = DagGraphTerms.namedNode(graphIri);
      const closedAt = this.#literalFor(graph, GraphStateTerms.DAGONIZER.ClosedAt);
      if (policy.requireClosed && closedAt === undefined) continue;
      if (closedAt === undefined) {
        if (!policy.requireClosed) eligible.add(graphIri);
        continue;
      }
      const lifecycle = this.#lifecycleFor(graph);
      const retentionMs = lifecycle === undefined
        ? policy.defaultRetentionMs
        : policy.lifecycleRetentionMs?.[lifecycle] ?? policy.defaultRetentionMs;
      const closedTime = Date.parse(closedAt);
      if (Number.isFinite(closedTime) && cutoff - closedTime >= retentionMs) eligible.add(graphIri);
    }
    return eligible;
  }

  #literalFor(subject: ReturnType<typeof DagGraphTerms.namedNode>, predicate: string): string | undefined {
    for (const quad of this.#dataset.match({ "subject": subject, "predicate": DagGraphTerms.namedNode(predicate), "graph": subject })) {
      if (quad.object.termType === 'Literal') return quad.object.value;
    }
    return undefined;
  }

  #lifecycleFor(subject: ReturnType<typeof DagGraphTerms.namedNode>): 'completed' | 'failed' | 'cancelled' | 'timed_out' | undefined {
    for (const quad of this.#dataset.match({ "subject": subject, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.LifecycleVariant), "graph": subject })) {
      if (quad.object.termType !== 'NamedNode') continue;
      const value = quad.object.value.slice(GraphStateTerms.DAGONIZER.namespace.length);
      if (value === 'completed' || value === 'failed' || value === 'cancelled' || value === 'timed_out') return value;
    }
    return undefined;
  }
}
