import type { NodeInterface, SchemaObjectType } from '../contracts/NodeInterface.js';
import type { QuadType, TermType, TripleStoreInterface } from '../contracts/TripleStoreInterface.js';
import { ContextResolver } from '../dag/ContextResolver.js';
import type { DAGType } from '../entities/dag/DAG.js';
import { DagReference } from '../entities/dag/DagReference.js';
import type { DagReferenceType } from '../entities/dag/DagReference.js';
import { Placement } from '../entities/dag/Placement.js';
import type { DAGNodeType } from '../entities/dag/Placement.js';
import type { NodeStateInterface } from '../NodeStateBase.js';
import type { SchemaRegistry } from '../schema/SchemaRegistry.js';
import { StableSchemaHash } from '../schema/StableSchemaHash.js';

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

    for (const [label, placementIri] of Object.entries(dag.entrypoints)) {
      const entrypoint = DagGraphTerms.namedNode(`${dagIri}/entrypoint/${encodeURIComponent(label)}`);
      store.assert(dagNode, DagGraphTerms.predicate('entrypoint'), entrypoint, graph);
      store.assert(entrypoint, DagGraphTerms.predicate('label'), DagGraphTerms.literal(label), graph);
      store.assert(entrypoint, DagGraphTerms.predicate('target'), DagGraphTerms.namedNode(placementIri), graph);
    }

    for (const placement of dag.nodes) {
      DagGraphProjector.projectPlacement(placement, dagIri, context, store, graph);
    }
  }

  static projectNodeSchemas<TState extends NodeStateInterface>(input: {
    readonly dag: DAGType;
    readonly nodes: ReadonlyMap<string, NodeInterface<TState, string>>;
    readonly schemas: SchemaRegistry;
    readonly store: TripleStoreInterface;
  }): void {
    const context = ContextResolver.contextOf(input.dag['@context']);
    const dagIri = DagGraphProjector.dagIri(input.dag);
    const graph = DagGraphTerms.namedNode(DagGraphProjector.topologyGraphIri(dagIri));

    for (const placement of input.dag.nodes) {
      const nodeRef = DagGraphProjector.nodeRefForSchemaProjection(placement);
      if (nodeRef === null) continue;
      const nodeIri = ContextResolver.expand(nodeRef, context);
      const node = input.nodes.get(nodeIri);
      if (node === undefined) continue;
      DagGraphProjector.projectNodeContract(
        placement['@id'],
        node,
        input.schemas,
        input.store,
        graph,
      );
    }

    DagGraphProjector.projectRouteSchemaAnnotations(input.dag, input.nodes, input.schemas, input.store, graph);
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
    return ContextResolver.expand(dag['@id'], ContextResolver.contextOf(dag['@context']));
  }

  static topologyGraphIri(dagIri: string): string {
    return `${dagIri}#topology`;
  }

  private static projectPlacement(
    placement: DAGNodeType,
    dagIri: string,
    context: Record<string, unknown>,
    store: TripleStoreInterface,
    graph: TermType,
  ): void {
    const placementIri = placement['@id'];
    const placementNode = DagGraphTerms.namedNode(placementIri);

    store.assert(DagGraphTerms.namedNode(dagIri), DagGraphTerms.predicate('placement'), placementNode, graph);
    store.assert(placementNode, DagGraphTerms.namedNode(DagGraphTerms.RDF_TYPE), DagGraphTerms.class(placement['@type']), graph);
    store.assert(placementNode, DagGraphTerms.predicate('name'), DagGraphTerms.literal(placement.name), graph);

    if ('outputs' in placement) {
      for (const [output, target] of Object.entries(placement.outputs)) {
        const route = DagGraphTerms.namedNode(`${placementIri}/route/${encodeURIComponent(output)}`);
        store.assert(placementNode, DagGraphTerms.predicate('route'), route, graph);
        store.assert(route, DagGraphTerms.predicate('output'), DagGraphTerms.literal(output), graph);
        store.assert(route, DagGraphTerms.predicate('target'), DagGraphTerms.namedNode(target), graph);
      }
    }

    if (Placement.isEmbeddedDAG(placement) && placement.dag !== undefined) {
      DagGraphProjector.projectDagReference(placement.dag, placementIri, context, store, graph);
    }
    if (Placement.isScatter(placement) && 'dag' in placement.body) {
      DagGraphProjector.projectDagReference(placement.body.dag, placementIri, context, store, graph);
    }
    if (Placement.isGather(placement)) {
      for (const [source, binding] of Object.entries(placement.sources)) {
        const sourceNode = DagGraphTerms.namedNode(`${placementIri}/source/${encodeURIComponent(source)}`);
        store.assert(placementNode, DagGraphTerms.predicate('source'), sourceNode, graph);
        store.assert(sourceNode, DagGraphTerms.predicate('label'), DagGraphTerms.literal(source), graph);
        if (binding.resultField !== undefined) {
          store.assert(sourceNode, DagGraphTerms.predicate('resultField'), DagGraphTerms.literal(binding.resultField), graph);
        }
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
      store.assert(owner, DagGraphTerms.predicate('embedsDag'), candidateDag, graph);
    }
  }

  private static projectNodeContract<TState extends NodeStateInterface>(
    placementIri: string,
    node: NodeInterface<TState, string>,
    schemas: SchemaRegistry,
    store: TripleStoreInterface,
    graph: TermType,
  ): void {
    const placementNode = DagGraphTerms.namedNode(placementIri);
    const inputPort = DagGraphTerms.namedNode(`${placementIri}/input`);
    const inputSchemaIri = schemas.register(node.inputSchema);
    DagGraphProjector.projectSchema(inputSchemaIri, node.inputSchema, schemas, store, graph);
    store.assert(placementNode, DagGraphTerms.predicate('inputPort'), inputPort, graph);
    store.assert(inputPort, DagGraphTerms.predicate('schema'), DagGraphTerms.namedNode(inputSchemaIri), graph);

    for (const [output, schema] of Object.entries(node.outputSchema)) {
      const outputPort = DagGraphTerms.namedNode(`${placementIri}/output/${encodeURIComponent(output)}`);
      const outputSchemaIri = schemas.register(schema);
      DagGraphProjector.projectSchema(outputSchemaIri, schema, schemas, store, graph);
      store.assert(placementNode, DagGraphTerms.predicate('outputPort'), outputPort, graph);
      store.assert(outputPort, DagGraphTerms.predicate('label'), DagGraphTerms.literal(output), graph);
      store.assert(outputPort, DagGraphTerms.predicate('schema'), DagGraphTerms.namedNode(outputSchemaIri), graph);
    }
  }

  private static projectRouteSchemaAnnotations<TState extends NodeStateInterface>(
    dag: DAGType,
    nodes: ReadonlyMap<string, NodeInterface<TState, string>>,
    schemas: SchemaRegistry,
    store: TripleStoreInterface,
    graph: TermType,
  ): void {
    const context = ContextResolver.contextOf(dag['@context']);
    const placementByIri = new Map(dag.nodes.map((placement) => [placement['@id'], placement]));
    for (const placement of dag.nodes) {
      if (!('outputs' in placement)) continue;
      const sourceNode = DagGraphProjector.nodeForPlacement(placement, context, nodes);
      if (sourceNode === undefined) continue;
      for (const [output, targetIri] of Object.entries(placement.outputs)) {
        const target = placementByIri.get(targetIri);
        if (target === undefined) continue;
        const targetNode = DagGraphProjector.nodeForPlacement(target, context, nodes);
        if (targetNode === undefined) continue;
        const produced = sourceNode.outputSchema[output];
        if (produced === undefined) continue;
        const sourcePlacement = DagGraphTerms.namedNode(placement['@id']);
        const routeStatement = DagGraphTerms.tripleTerm(
          sourcePlacement,
          DagGraphTerms.predicate('route'),
          DagGraphTerms.namedNode(targetIri),
        );
        store.assert(
          routeStatement,
          DagGraphTerms.predicate('producesSchema'),
          DagGraphTerms.namedNode(schemas.register(produced)),
          graph,
        );
        store.assert(
          routeStatement,
          DagGraphTerms.predicate('requiresSchema'),
          DagGraphTerms.namedNode(schemas.register(targetNode.inputSchema)),
          graph,
        );
      }
    }
  }

  private static projectSchema(
    schemaIri: string,
    schema: SchemaObjectType,
    schemas: SchemaRegistry,
    store: TripleStoreInterface,
    graph: TermType,
  ): void {
    const schemaNode = DagGraphTerms.namedNode(schemaIri);
    store.assert(schemaNode, DagGraphTerms.namedNode(DagGraphTerms.RDF_TYPE), DagGraphTerms.class('Schema'), graph);
    store.assert(
      schemaNode,
      DagGraphTerms.predicate('contractHash'),
      DagGraphTerms.literal(StableSchemaHash.of(schema)),
      graph,
    );
    if (schemas.get(schemaIri) === undefined) schemas.register(schema);
  }

  private static nodeForPlacement<TState extends NodeStateInterface>(
    placement: DAGNodeType,
    context: Record<string, unknown>,
    nodes: ReadonlyMap<string, NodeInterface<TState, string>>,
  ): NodeInterface<TState, string> | undefined {
    if (!Placement.isSingle(placement) && !Placement.isPhase(placement)) return undefined;
    return nodes.get(ContextResolver.expand(placement.node, context));
  }

  private static nodeRefForSchemaProjection(placement: DAGNodeType): string | null {
    if (Placement.isSingle(placement)) return placement.node;
    if (Placement.isPhase(placement)) return placement.node;
    return null;
  }
}
