import type { NodeInterface, SchemaObjectType } from '../contracts/NodeInterface.js';
import { GatherStrategies } from '../core/GatherStrategies.js';
import { ContextResolver } from '../dag/ContextResolver.js';
import type { DAGType } from '../entities/dag/DAG.js';
import { DagReference } from '../entities/dag/DagReference.js';
import type { DagReferenceType } from '../entities/dag/DagReference.js';
import type { EmbeddedDAGNodeType } from '../entities/dag/EmbeddedDAGNode.js';
import type { GatherConfigType } from '../entities/dag/GatherConfig.js';
import type { GatherNodeType } from '../entities/dag/GatherNode.js';
import type { PhaseNodeType } from '../entities/dag/PhaseNode.js';
import { Placement } from '../entities/dag/Placement.js';
import type { DAGNodeType } from '../entities/dag/Placement.js';
import type { ScatterNodeType } from '../entities/dag/ScatterNode.js';
import type { SingleNodePlacementType } from '../entities/dag/SingleNode.js';
import { DAGError } from '../errors/index.js';
import { DagGraphProjector } from '../graph/DagGraphProjector.js';
import { DagGraphQueries } from '../graph/DagGraphQueries.js';
import { DagReferenceGraph } from '../graph/DagReferenceGraph.js';
import type { DagReferenceEdgeType } from '../graph/DagReferenceGraph.js';
import type { NodeStateInterface } from '../NodeStateBase.js';
import { JsonSchemaCompatibility } from '../schema/JsonSchemaCompatibility.js';
import { SchemaRegistry } from '../schema/SchemaRegistry.js';

export class DAGValidator {
  private constructor() { /* static class */ }

  static validateDAGConfig<TState extends NodeStateInterface>(
    dag: DAGType,
    context: Record<string, unknown>,
    nodes: Map<string, NodeInterface<TState, string>>,
    dags: Map<string, DAGType>,
  ): void {
    const errors: string[] = [];
    for (const node of dag.nodes) {
      DAGValidator.validateDAGNode(dag, node, context, nodes, dags, errors);
    }
    DAGValidator.validateRouteSchemas(dag, nodes, errors);

    if (errors.length > 0) {
      throw new DAGError(`Invalid DAG '${dag.name}':\n  - ${errors.join('\n  - ')}`);
    }
  }

  static validateReferenceGraph(dags: ReadonlyMap<string, DAGType>): void {
    const errors: string[] = [];
    const edges = DagReferenceGraph.referenceEdges(dags);

    for (const edge of edges) {
      if (!dags.has(edge.targetDagIri)) {
        errors.push(`DAG '${edge.sourceDagIri}' placement '${edge.sourcePlacement}' references unknown DAG '${edge.targetDagIri}'`);
      }
    }

    for (const component of DagReferenceGraph.stronglyConnectedComponents(dags.keys(), edges)) {
      if (component.length === 1 && !DagReferenceGraph.hasSelfEdge(component[0] ?? '', edges)) continue;
      DAGValidator.validateRecursiveComponent(component, dags, edges, errors);
    }

    if (errors.length > 0) {
      throw new DAGError(`Invalid DAG registry graph:\n  - ${errors.join('\n  - ')}`);
    }
  }

  private static validateDAGNode<TState extends NodeStateInterface>(
    dag: DAGType,
    entry: DAGNodeType,
    context: Record<string, unknown>,
    nodes: Map<string, NodeInterface<TState, string>>,
    dags: Map<string, DAGType>,
    errors: string[],
  ): void {
    if (Placement.isEmbeddedDAG(entry)) {
      DAGValidator.validateEmbeddedDAGNode(entry, context, nodes, dags, errors);
    } else if (Placement.isScatter(entry)) {
      DAGValidator.validateScatterNode(entry, context, nodes, dags, errors);
    } else if (Placement.isSingle(entry)) {
      DAGValidator.validateSingleNode(entry, context, nodes, errors);
    } else if (Placement.isGather(entry)) {
      DAGValidator.validateGatherNode(dag, entry, context, nodes, dags, errors);
    } else if (Placement.isPhase(entry)) {
      DAGValidator.validatePhaseNode(entry, context, nodes, errors);
    }
    // TerminalNode: no registry-relative references to validate.
  }

  private static validatePhaseNode<TState extends NodeStateInterface>(
    phase: PhaseNodeType,
    context: Record<string, unknown>,
    nodes: Map<string, NodeInterface<TState, string>>,
    errors: string[],
  ): void {
    const nodeIri = ContextResolver.expand(phase.node, context);
    if (!nodes.has(nodeIri)) {
      errors.push(`PhaseNode '${phase.name}' references unknown registered node: ${phase.node}`);
    }
  }

  private static validateSingleNode<TState extends NodeStateInterface>(
    nodeConfig: SingleNodePlacementType,
    context: Record<string, unknown>,
    nodes: Map<string, NodeInterface<TState, string>>,
    errors: string[],
  ): void {
    const nodeIri = ContextResolver.expand(nodeConfig.node, context);
    const dagNode = nodes.get(nodeIri);

    if (!dagNode) {
      errors.push(`Node '${nodeConfig.name}' references unknown registered node: ${nodeConfig.node}`);
      return;
    }

    for (const output of dagNode.outputs) {
      // 'parked' is a reserved engine-level output for HITL park-and-correlate.
      // The engine intercepts it before routing; no placement-level routing entry is required.
      if (output === 'parked') continue;
      if (!(output in nodeConfig.outputs)) {
        errors.push(`Node '${nodeConfig.name}': registered node '${dagNode.name}' declares output '${output}' but no routing is defined`);
      }
    }
  }

  private static validateEmbeddedDAGNode(
    placement: EmbeddedDAGNodeType,
    context: Record<string, unknown>,
    nodes: Map<string, NodeInterface<NodeStateInterface, string>>,
    dags: Map<string, DAGType>,
    errors: string[],
  ): void {
    if (placement.dag !== undefined) {
      DAGValidator.validateDagReference(placement.dag, context, dags, `EmbeddedDAGNode '${placement.name}'`, errors);
      DAGValidator.validateChildInputMapping(
        `EmbeddedDAGNode '${placement.name}'`,
        placement.dag,
        placement.stateMapping?.input ?? {},
        context,
        nodes,
        dags,
        errors,
      );
      DAGValidator.validateChildOutputMapping(
        `EmbeddedDAGNode '${placement.name}'`,
        placement.dag,
        placement.stateMapping?.output ?? {},
        context,
        nodes,
        dags,
        errors,
      );
      if (placement.gatherResult !== undefined) {
        DAGValidator.validateDagResultField(
          `EmbeddedDAGNode '${placement.name}' gatherResult.resultField`,
          placement.dag,
          placement.gatherResult.resultField,
          context,
          nodes,
          dags,
          errors,
        );
      }
    }
  }

  private static validateScatterNode<TState extends NodeStateInterface>(
    scatter: ScatterNodeType,
    context: Record<string, unknown>,
    nodes: Map<string, NodeInterface<TState, string>>,
    dags: Map<string, DAGType>,
    errors: string[],
  ): void {
    if ('node' in scatter.body) {
      const bodyNodeIri = ContextResolver.expand(scatter.body.node, context);
      const bodyNode = nodes.get(bodyNodeIri);
      if (bodyNode === undefined) {
        errors.push(`ScatterNode '${scatter.name}': unknown registered node '${scatter.body.node}'`);
      } else {
        let producerResultSchemas: readonly SchemaObjectType[] = [];
        DAGValidator.validateRequiredFieldsSeeded(
          `ScatterNode '${scatter.name}' body node '${scatter.body.node}'`,
          bodyNode.inputSchema,
          {
            ...scatter.stateMapping?.input,
            [scatter.itemKey ?? 'currentItem']: scatter.source,
          },
          errors,
        );
        if (scatter.gather.resultField !== undefined) {
          DAGValidator.validateNodeResultField(
            `ScatterNode '${scatter.name}' gather.resultField`,
            bodyNode,
            scatter.gather.resultField,
            errors,
          );
          producerResultSchemas = DAGValidator.resultSchemasFromNode(bodyNode, scatter.gather.resultField);
        }
        DAGValidator.validateGatherStrategyResultSchema(
          scatter.name,
          scatter.gather,
          producerResultSchemas,
          producerResultSchemas.length === 0 ? [`ScatterNode '${scatter.name}'`] : [],
          errors,
        );
      }
    } else if ('dag' in scatter.body) {
      let producerResultSchemas: readonly SchemaObjectType[] = [];
      DAGValidator.validateDagReference(scatter.body.dag, context, dags, `ScatterNode '${scatter.name}'`, errors);
      DAGValidator.validateChildInputMapping(
        `ScatterNode '${scatter.name}' DAG body`,
        scatter.body.dag,
        {
          ...scatter.stateMapping?.input,
          [scatter.itemKey ?? 'currentItem']: scatter.source,
        },
        context,
        nodes,
        dags,
        errors,
      );
      if (scatter.gather.resultField !== undefined) {
        DAGValidator.validateDagResultField(
          `ScatterNode '${scatter.name}' gather.resultField`,
          scatter.body.dag,
          scatter.gather.resultField,
          context,
          nodes,
          dags,
          errors,
        );
        producerResultSchemas = DAGValidator.resultSchemasFromDagTerminalRoutes(scatter.body.dag, scatter.gather.resultField, context, nodes, dags);
      }
      DAGValidator.validateGatherStrategyResultSchema(
        scatter.name,
        scatter.gather,
        producerResultSchemas,
        producerResultSchemas.length === 0 ? [`ScatterNode '${scatter.name}'`] : [],
        errors,
      );
    }

    DAGValidator.validateGatherConfig(scatter.name, scatter.gather, context, nodes, errors);
  }

  private static validateGatherNode<TState extends NodeStateInterface>(
    dag: DAGType,
    gatherNode: GatherNodeType,
    context: Record<string, unknown>,
    nodes: Map<string, NodeInterface<TState, string>>,
    dags: Map<string, DAGType>,
    errors: string[],
  ): void {
    DAGValidator.validateGatherConfig(gatherNode.name, gatherNode.gather, context, nodes, errors);
    const producerResult = DAGValidator.resultSchemasForGatherNode(dag, gatherNode, context, nodes, dags);
    DAGValidator.validateGatherStrategyResultSchema(
      gatherNode.name,
      gatherNode.gather,
      producerResult.producerSchemas,
      producerResult.missingProducers,
      errors,
    );
  }

  private static validateGatherConfig<TState extends NodeStateInterface>(
    ownerName: string,
    gather: GatherConfigType,
    context: Record<string, unknown>,
    nodes: Map<string, NodeInterface<TState, string>>,
    errors: string[],
  ): void {
    if (gather.strategy === 'custom' && gather.customNode !== undefined) {
      const customNodeIri = ContextResolver.expand(gather.customNode, context);
      if (!nodes.has(customNodeIri)) {
        errors.push(`Gather '${ownerName}': custom gather node '${gather.customNode}' not found`);
      }
    }
  }

  private static validateDagReference(
    reference: DagReferenceType,
    context: Record<string, unknown>,
    dags: Map<string, DAGType>,
    owner: string,
    errors: string[],
  ): void {
    for (const candidate of DagReference.candidates(reference)) {
      const dagIri = ContextResolver.expand(candidate, context);
      if (!dags.has(dagIri)) {
        errors.push(`${owner}: unknown registered DAG '${candidate}'`);
      }
    }
  }

  private static validateRouteSchemas<TState extends NodeStateInterface>(
    dag: DAGType,
    nodes: Map<string, NodeInterface<TState, string>>,
    errors: string[],
  ): void {
    const store = DagGraphProjector.store(dag);
    const schemas = new SchemaRegistry();
    DagGraphProjector.projectNodeSchemas({ dag, nodes, schemas, store });
    const dagIri = DagGraphProjector.dagIri(dag);

    for (const placement of dag.nodes) {
      if (!('outputs' in placement)) continue;
      const sourceIri = DagGraphProjector.placementIri(dagIri, placement.name);
      for (const [output, target] of Object.entries(placement.outputs)) {
        const producedIri = DagGraphQueries.placementOutputSchemaIri(store, sourceIri, output);
        if (producedIri === undefined) continue;
        const targetIri = DagGraphProjector.placementIri(dagIri, target);
        const requiredIri = DagGraphQueries.placementInputSchemaIri(store, targetIri);
        if (requiredIri === undefined) continue;
        const produced = schemas.get(producedIri);
        const required = schemas.get(requiredIri);
        if (produced === undefined || required === undefined) continue;

        const compatibility = JsonSchemaCompatibility.produces(produced, required);
        if (compatibility.status === 'incompatible') {
          errors.push(
            `Route '${placement.name}.${output}' -> '${target}' does not satisfy target input schema: ${compatibility.reason}`,
          );
        }
      }
    }
  }

  private static validateChildInputMapping<TState extends NodeStateInterface>(
    owner: string,
    reference: DagReferenceType,
    inputMapping: Readonly<Record<string, string>>,
    context: Record<string, unknown>,
    nodes: Map<string, NodeInterface<TState, string>>,
    dags: Map<string, DAGType>,
    errors: string[],
  ): void {
    for (const childDag of DAGValidator.candidateDags(reference, context, dags)) {
      const childContext = ContextResolver.contextOf(childDag['@context']);
      for (const [label, placementName] of Object.entries(childDag.entrypoints)) {
        const placement = DAGValidator.placementByName(childDag, placementName);
        if (placement === undefined) continue;
        const inputSchema = DAGValidator.inputSchemaForPlacement(placement, childContext, nodes);
        if (inputSchema === undefined) continue;
        DAGValidator.validateRequiredFieldsSeeded(
          `${owner} -> child DAG '${childDag.name}' entrypoint '${label}'`,
          inputSchema,
          inputMapping,
          errors,
        );
      }
    }
  }

  private static validateRequiredFieldsSeeded(
    owner: string,
    inputSchema: NodeInterface['inputSchema'],
    inputMapping: Readonly<Record<string, string>>,
    errors: string[],
  ): void {
    for (const field of DAGValidator.requiredFields(inputSchema)) {
      if (inputMapping[field] !== undefined) continue;
      errors.push(`${owner} does not seed required input field '${field}'`);
    }
  }

  private static validateDagResultField<TState extends NodeStateInterface>(
    owner: string,
    reference: DagReferenceType,
    resultField: string,
    context: Record<string, unknown>,
    nodes: Map<string, NodeInterface<TState, string>>,
    dags: Map<string, DAGType>,
    errors: string[],
  ): void {
    for (const childDag of DAGValidator.candidateDags(reference, context, dags)) {
      const producedSchemas = DAGValidator.terminalProducerSchemas(childDag, nodes)
        .filter((schema) => DAGValidator.schemaDeclaresProperties(schema));
      if (producedSchemas.length === 0) continue;
      if (producedSchemas.some((schema) => DAGValidator.schemaHasPath(schema, resultField))) continue;
      errors.push(`${owner} '${resultField}' is not produced by child DAG '${childDag.name}' terminal routes`);
    }
  }

  private static validateChildOutputMapping<TState extends NodeStateInterface>(
    owner: string,
    reference: DagReferenceType,
    outputMapping: Readonly<Record<string, string>>,
    context: Record<string, unknown>,
    nodes: Map<string, NodeInterface<TState, string>>,
    dags: Map<string, DAGType>,
    errors: string[],
  ): void {
    for (const [parentPath, childPath] of Object.entries(outputMapping)) {
      for (const childDag of DAGValidator.candidateDags(reference, context, dags)) {
        const producedSchemas = DAGValidator.terminalProducerSchemas(childDag, nodes)
          .filter((schema) => DAGValidator.schemaDeclaresProperties(schema));
        if (producedSchemas.length === 0) continue;
        if (producedSchemas.some((schema) => DAGValidator.schemaHasPath(schema, childPath))) continue;
        errors.push(`${owner} stateMapping.output '${parentPath}' reads child path '${childPath}' that is not produced by child DAG '${childDag.name}' terminal routes`);
      }
    }
  }

  private static validateNodeResultField<TState extends NodeStateInterface>(
    owner: string,
    node: NodeInterface<TState, string>,
    resultField: string,
    errors: string[],
  ): void {
    const schemas = Object.values(node.outputSchema)
      .filter((schema) => DAGValidator.schemaDeclaresProperties(schema));
    if (schemas.length === 0) return;
    if (schemas.some((schema) => DAGValidator.schemaHasPath(schema, resultField))) return;
    errors.push(`${owner} '${resultField}' is not produced by registered node '${node.name}' output schemas`);
  }

  private static validateGatherStrategyResultSchema(
    ownerName: string,
    gather: GatherConfigType,
    producerSchemas: readonly SchemaObjectType[],
    missingProducers: readonly string[],
    errors: string[],
  ): void {
    const strategy = GatherStrategies.get(gather.strategy);
    if (strategy?.resultSchema === undefined) return;
    for (const producer of missingProducers) {
      errors.push(`Gather '${ownerName}' strategy '${gather.strategy}' declares resultSchema but ${producer} does not declare a producer result schema`);
    }
    for (const produced of producerSchemas) {
      const compatibility = JsonSchemaCompatibility.produces(produced, strategy.resultSchema);
      if (compatibility.status !== 'incompatible') continue;
      errors.push(
        `Gather '${ownerName}' producer result schema does not satisfy strategy '${gather.strategy}' result schema: ${compatibility.reason}`,
      );
    }
  }

  private static resultSchemasForGatherNode<TState extends NodeStateInterface>(
    dag: DAGType,
    gatherNode: GatherNodeType,
    context: Record<string, unknown>,
    nodes: Map<string, NodeInterface<TState, string>>,
    dags: Map<string, DAGType>,
  ): { readonly producerSchemas: readonly SchemaObjectType[]; readonly missingProducers: readonly string[] } {
    const producerSchemas: SchemaObjectType[] = [];
    const missingProducers: string[] = [];
    for (const source of gatherNode.sources) {
      const placementName = dag.entrypoints[source] ?? source;
      const placement = DAGValidator.placementByName(dag, placementName);
      if (placement === undefined) continue;
      const sourceSchemas = DAGValidator.resultSchemasForPlacementProducer(
        placement,
        context,
        nodes,
        dags,
      );
      if (sourceSchemas.length === 0) {
        missingProducers.push(`source '${source}'`);
      } else {
        producerSchemas.push(...sourceSchemas);
      }
    }
    return { producerSchemas, missingProducers };
  }

  private static resultSchemasForPlacementProducer<TState extends NodeStateInterface>(
    placement: DAGNodeType,
    context: Record<string, unknown>,
    nodes: Map<string, NodeInterface<TState, string>>,
    dags: Map<string, DAGType>,
  ): readonly SchemaObjectType[] {
    if (Placement.isScatter(placement)) {
      if (placement.gather.resultField === undefined) return [];
      if ('node' in placement.body) {
        const bodyNode = nodes.get(ContextResolver.expand(placement.body.node, context));
        return bodyNode === undefined
          ? []
          : DAGValidator.resultSchemasFromNode(bodyNode, placement.gather.resultField);
      }
      return DAGValidator.resultSchemasFromDagTerminalRoutes(placement.body.dag, placement.gather.resultField, context, nodes, dags);
    }
    if (Placement.isEmbeddedDAG(placement) && placement.dag !== undefined && placement.gatherResult !== undefined) {
      return DAGValidator.resultSchemasFromDagTerminalRoutes(placement.dag, placement.gatherResult.resultField, context, nodes, dags);
    }
    return [];
  }

  private static resultSchemasFromDagTerminalRoutes<TState extends NodeStateInterface>(
    reference: DagReferenceType,
    resultField: string,
    context: Record<string, unknown>,
    nodes: Map<string, NodeInterface<TState, string>>,
    dags: Map<string, DAGType>,
  ): readonly SchemaObjectType[] {
    const result: SchemaObjectType[] = [];
    for (const childDag of DAGValidator.candidateDags(reference, context, dags)) {
      result.push(...DAGValidator.resultSchemasFromOutputSchemas(
        DAGValidator.terminalProducerSchemas(childDag, nodes),
        resultField,
      ));
    }
    return result;
  }

  private static resultSchemasFromNode<TState extends NodeStateInterface>(
    node: NodeInterface<TState, string>,
    resultField: string,
  ): readonly SchemaObjectType[] {
    return DAGValidator.resultSchemasFromOutputSchemas(Object.values(node.outputSchema), resultField);
  }

  private static resultSchemasFromOutputSchemas(
    outputSchemas: Iterable<SchemaObjectType>,
    resultField: string,
  ): readonly SchemaObjectType[] {
    const result: SchemaObjectType[] = [];
    for (const schema of outputSchemas) {
      const resultSchema = DAGValidator.schemaAtPath(schema, resultField);
      if (resultSchema !== undefined) result.push(resultSchema);
    }
    return result;
  }

  private static terminalProducerSchemas<TState extends NodeStateInterface>(
    dag: DAGType,
    nodes: Map<string, NodeInterface<TState, string>>,
  ): readonly NodeInterface['inputSchema'][] {
    const context = ContextResolver.contextOf(dag['@context']);
    const placements = new Map<string, DAGNodeType>();
    const schemas: NodeInterface['inputSchema'][] = [];
    for (const placement of dag.nodes) placements.set(placement.name, placement);
    for (const placement of dag.nodes) {
      if (!('outputs' in placement)) continue;
      for (const [output, target] of Object.entries(placement.outputs)) {
        const targetPlacement = placements.get(target);
        if (targetPlacement === undefined || !Placement.isTerminal(targetPlacement)) continue;
        const outputSchema = DAGValidator.outputSchemaForPlacement(placement, output, context, nodes);
        if (outputSchema !== undefined) schemas.push(outputSchema);
      }
    }
    return schemas;
  }

  private static inputSchemaForPlacement<TState extends NodeStateInterface>(
    placement: DAGNodeType,
    context: Record<string, unknown>,
    nodes: Map<string, NodeInterface<TState, string>>,
  ): NodeInterface['inputSchema'] | undefined {
    const nodeName = DAGValidator.registeredNodeName(placement);
    if (nodeName === null) return undefined;
    return nodes.get(ContextResolver.expand(nodeName, context))?.inputSchema;
  }

  private static outputSchemaForPlacement<TState extends NodeStateInterface>(
    placement: DAGNodeType,
    output: string,
    context: Record<string, unknown>,
    nodes: Map<string, NodeInterface<TState, string>>,
  ): NodeInterface['inputSchema'] | undefined {
    const nodeName = DAGValidator.registeredNodeName(placement);
    if (nodeName === null) return undefined;
    return nodes.get(ContextResolver.expand(nodeName, context))?.outputSchema[output];
  }

  private static registeredNodeName(placement: DAGNodeType): string | null {
    if (Placement.isSingle(placement)) return placement.node;
    if (Placement.isPhase(placement)) return placement.node;
    return null;
  }

  private static candidateDags(
    reference: DagReferenceType,
    context: Record<string, unknown>,
    dags: Map<string, DAGType>,
  ): readonly DAGType[] {
    const result: DAGType[] = [];
    for (const candidate of DagReference.candidates(reference)) {
      const dag = dags.get(ContextResolver.expand(candidate, context));
      if (dag !== undefined) result.push(dag);
    }
    return result;
  }

  private static placementByName(dag: DAGType, name: string): DAGNodeType | undefined {
    return dag.nodes.find((placement) => placement.name === name);
  }

  private static requiredFields(schema: NodeInterface['inputSchema']): readonly string[] {
    const value = Reflect.get(schema, 'required');
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string')
      : [];
  }

  private static schemaHasPath(schema: NodeInterface['inputSchema'], path: string): boolean {
    return DAGValidator.schemaAtPath(schema, path) !== undefined;
  }

  private static schemaAtPath(schema: NodeInterface['inputSchema'], path: string): NodeInterface['inputSchema'] | undefined {
    let cursor: NodeInterface['inputSchema'] | undefined = schema;
    for (const segment of path.split('.')) {
      if (segment.length === 0 || cursor === undefined) return undefined;
      cursor = DAGValidator.propertySchema(cursor, segment);
    }
    return cursor;
  }

  private static propertySchema(schema: NodeInterface['inputSchema'], property: string): NodeInterface['inputSchema'] | undefined {
    const properties = Reflect.get(schema, 'properties');
    if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) return undefined;
    const value = Reflect.get(properties, property);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value
      : undefined;
  }

  private static schemaDeclaresProperties(schema: NodeInterface['inputSchema']): boolean {
    const properties = Reflect.get(schema, 'properties');
    return typeof properties === 'object' && properties !== null && !Array.isArray(properties);
  }

  private static validateRecursiveComponent(
    component: readonly string[],
    dags: ReadonlyMap<string, DAGType>,
    edges: readonly DagReferenceEdgeType[],
    errors: string[],
  ): void {
    const recursiveDagIris = new Set(component);
    for (const dagIri of component) {
      const dag = dags.get(dagIri);
      if (dag !== undefined && !DAGValidator.hasReachableTerminalEscape(dag, dagIri, recursiveDagIris, edges)) {
        errors.push(`Recursive DAG component containing '${dagIri}' has no terminal exit path`);
      }
    }
  }

  private static hasReachableTerminalEscape(
    dag: DAGType,
    dagIri: string,
    recursiveDagIris: ReadonlySet<string>,
    edges: readonly DagReferenceEdgeType[],
  ): boolean {
    const placements = new Map<string, DAGNodeType>();
    for (const placement of dag.nodes) placements.set(placement.name, placement);

    const recursivePlacements = new Set<string>();
    for (const edge of edges) {
      if (edge.sourceDagIri === dagIri && recursiveDagIris.has(edge.targetDagIri)) {
        recursivePlacements.add(edge.sourcePlacement);
      }
    }

    const visited = new Set<string>();
    const queue = Object.values(dag.entrypoints);
    while (queue.length > 0) {
      const placementName = queue.shift();
      if (placementName === undefined || visited.has(placementName)) continue;
      visited.add(placementName);
      const placement = placements.get(placementName);
      if (placement === undefined) continue;
      if (Placement.isTerminal(placement)) return true;
      if (recursivePlacements.has(placement.name)) continue;
      if ('outputs' in placement) queue.push(...Object.values(placement.outputs));
    }
    return false;
  }

}
