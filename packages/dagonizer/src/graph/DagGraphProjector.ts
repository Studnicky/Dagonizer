import type { NodeInterface } from '../contracts/NodeInterface.js';
import type { QuadType, TermType, TripleStoreInterface } from '../contracts/TripleStoreInterface.js';
import { ContextResolver } from '../dag/ContextResolver.js';
import type { DAGType } from '../entities/dag/DAG.js';
import { DagReference } from '../entities/dag/DagReference.js';
import type { DagReferenceType } from '../entities/dag/DagReference.js';
import { Placement } from '../entities/dag/Placement.js';
import type { DAGNodeType } from '../entities/dag/Placement.js';
import type { NodeStateInterface } from '../NodeStateBase.js';
import type { SchemaRegistry } from '../schema/SchemaRegistry.js';

import { DagGraphTerms } from './DagGraphTerms.js';
import { InMemoryTopologyStore } from './InMemoryTopologyStore.js';

export class DagGraphProjector {
  private constructor() { /* static-only */ }

  static readonly RUNTIME_GRAPH = 'urn:dagonizer:runtime';

  static store(dag: DAGType): TripleStoreInterface {
    const store = new InMemoryTopologyStore();
    DagGraphProjector.project(dag, store);
    return store;
  }

  static quads(dag: DAGType): readonly QuadType[] {
    return [...DagGraphProjector.store(dag).triples()];
  }

  static project(dag: DAGType, store: TripleStoreInterface): void {
    const context = ContextResolver.contextOf(dag['@context']);
    const dagIri = DagGraphProjector.dagIri(dag);
    const graph = DagGraphTerms.namedNode(DagGraphProjector.topologyGraphIri(dagIri));
    const dagNode = DagGraphTerms.namedNode(dagIri);

    store.assert(dagNode, DagGraphTerms.namedNode(DagGraphTerms.RDF_TYPE), DagGraphTerms.class('DAG'), graph);
    store.assert(dagNode, DagGraphTerms.predicate('name'), DagGraphTerms.literal(dag.name), graph);
    store.assert(dagNode, DagGraphTerms.predicate('version'), DagGraphTerms.literal(dag.version), graph);

    for (const [label, placementName] of Object.entries(dag.entrypoints)) {
      const entrypoint = DagGraphTerms.namedNode(`${dagIri}/entrypoint/${encodeURIComponent(label)}`);
      store.assert(dagNode, DagGraphTerms.predicate('entrypoint'), entrypoint, graph);
      store.assert(entrypoint, DagGraphTerms.predicate('label'), DagGraphTerms.literal(label), graph);
      store.assert(entrypoint, DagGraphTerms.predicate('target'), DagGraphTerms.namedNode(DagGraphProjector.placementIri(dagIri, placementName)), graph);
    }

    for (const placement of dag.nodes) {
      DagGraphProjector.projectPlacement(placement, dagIri, context, store, graph);
    }
  }

  static projectNodeSchemas(input: {
    readonly dag: DAGType;
    readonly nodes: ReadonlyMap<string, NodeInterface<NodeStateInterface, string>>;
    readonly schemas: SchemaRegistry;
    readonly store: TripleStoreInterface;
  }): void {
    const context = ContextResolver.contextOf(input.dag['@context']);
    const dagIri = DagGraphProjector.dagIri(input.dag);
    const graph = DagGraphTerms.namedNode(DagGraphProjector.topologyGraphIri(dagIri));

    for (const placement of input.dag.nodes) {
      const nodeName = DagGraphProjector.nodeNameForSchemaProjection(placement);
      if (nodeName === null) continue;
      const nodeIri = ContextResolver.expand(nodeName, context);
      const node = input.nodes.get(nodeIri);
      if (node === undefined) continue;
      DagGraphProjector.projectNodeContract(
        DagGraphProjector.placementIri(dagIri, placement.name),
        node,
        input.schemas,
        input.store,
        graph,
      );
    }
  }

  static bindSelectedDag(
    store: TripleStoreInterface,
    ownerPlacementIri: string,
    selectedDagIri: string,
    graphIri: string = DagGraphProjector.RUNTIME_GRAPH,
  ): void {
    store.assert(
      DagGraphTerms.namedNode(ownerPlacementIri),
      DagGraphTerms.predicate('selectedDag'),
      DagGraphTerms.namedNode(selectedDagIri),
      DagGraphTerms.namedNode(graphIri),
    );
  }

  static dagIri(dag: DAGType): string {
    return ContextResolver.expand(dag.name, ContextResolver.contextOf(dag['@context']));
  }

  static topologyGraphIri(dagIri: string): string {
    return `${dagIri}#topology`;
  }

  static placementIri(dagIri: string, placementName: string): string {
    return `${dagIri}#${encodeURIComponent(placementName)}`;
  }

  private static projectPlacement(
    placement: DAGNodeType,
    dagIri: string,
    context: Record<string, unknown>,
    store: TripleStoreInterface,
    graph: TermType,
  ): void {
    const placementIri = DagGraphProjector.placementIri(dagIri, placement.name);
    const placementNode = DagGraphTerms.namedNode(placementIri);

    store.assert(DagGraphTerms.namedNode(dagIri), DagGraphTerms.predicate('placement'), placementNode, graph);
    store.assert(placementNode, DagGraphTerms.namedNode(DagGraphTerms.RDF_TYPE), DagGraphTerms.class(placement['@type']), graph);
    store.assert(placementNode, DagGraphTerms.predicate('name'), DagGraphTerms.literal(placement.name), graph);

    if ('outputs' in placement) {
      for (const [output, target] of Object.entries(placement.outputs)) {
        const route = DagGraphTerms.namedNode(`${placementIri}/route/${encodeURIComponent(output)}`);
        store.assert(placementNode, DagGraphTerms.predicate('route'), route, graph);
        store.assert(route, DagGraphTerms.predicate('output'), DagGraphTerms.literal(output), graph);
        store.assert(route, DagGraphTerms.predicate('target'), DagGraphTerms.namedNode(DagGraphProjector.placementIri(dagIri, target)), graph);
      }
    }

    if (Placement.isEmbeddedDAG(placement) && placement.dag !== undefined) {
      DagGraphProjector.projectDagReference(placement.dag, placementIri, context, store, graph);
    }
    if (Placement.isScatter(placement) && 'dag' in placement.body) {
      DagGraphProjector.projectDagReference(placement.body.dag, placementIri, context, store, graph);
    }
    if (Placement.isGather(placement)) {
      for (const source of placement.sources) {
        store.assert(placementNode, DagGraphTerms.predicate('source'), DagGraphTerms.literal(source), graph);
      }
    }
  }

  private static projectDagReference(
    reference: DagReferenceType,
    ownerPlacementIri: string,
    context: Record<string, unknown>,
    store: TripleStoreInterface,
    graph: TermType,
  ): void {
    const owner = DagGraphTerms.namedNode(ownerPlacementIri);
    const referenceNode = DagGraphTerms.namedNode(`${ownerPlacementIri}/dag-reference`);
    store.assert(owner, DagGraphTerms.predicate('dagReference'), referenceNode, graph);

    if (DagReference.isDynamic(reference)) {
      store.assert(referenceNode, DagGraphTerms.namedNode(DagGraphTerms.RDF_TYPE), DagGraphTerms.class('DagReference'), graph);
      store.assert(referenceNode, DagGraphTerms.predicate('from'), DagGraphTerms.literal(reference.from), graph);
      store.assert(referenceNode, DagGraphTerms.predicate('path'), DagGraphTerms.literal(reference.path), graph);
    }

    for (const candidate of DagReference.candidates(reference)) {
      const candidateDag = DagGraphTerms.namedNode(ContextResolver.expand(candidate, context));
      store.assert(referenceNode, DagGraphTerms.predicate('candidateDag'), candidateDag, graph);
      store.assert(referenceNode, DagGraphTerms.predicate('candidateName'), DagGraphTerms.literal(candidate), graph);
      store.assert(owner, DagGraphTerms.predicate('embedsDag'), candidateDag, graph);
    }
  }

  private static projectNodeContract(
    placementIri: string,
    node: NodeInterface<NodeStateInterface, string>,
    schemas: SchemaRegistry,
    store: TripleStoreInterface,
    graph: TermType,
  ): void {
    const placementNode = DagGraphTerms.namedNode(placementIri);
    const inputPort = DagGraphTerms.namedNode(`${placementIri}/input`);
    const inputSchemaIri = schemas.register(node.inputSchema);
    store.assert(placementNode, DagGraphTerms.predicate('inputPort'), inputPort, graph);
    store.assert(inputPort, DagGraphTerms.predicate('schema'), DagGraphTerms.namedNode(inputSchemaIri), graph);

    for (const [output, schema] of Object.entries(node.outputSchema)) {
      const outputPort = DagGraphTerms.namedNode(`${placementIri}/output/${encodeURIComponent(output)}`);
      const outputSchemaIri = schemas.register(schema);
      store.assert(placementNode, DagGraphTerms.predicate('outputPort'), outputPort, graph);
      store.assert(outputPort, DagGraphTerms.predicate('label'), DagGraphTerms.literal(output), graph);
      store.assert(outputPort, DagGraphTerms.predicate('schema'), DagGraphTerms.namedNode(outputSchemaIri), graph);
    }
  }

  private static nodeNameForSchemaProjection(placement: DAGNodeType): string | null {
    if (Placement.isSingle(placement)) return placement.node;
    if (Placement.isPhase(placement)) return placement.node;
    return null;
  }
}
