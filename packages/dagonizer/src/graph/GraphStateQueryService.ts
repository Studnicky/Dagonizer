import type { GraphDatasetInterface } from '../contracts/GraphDatasetInterface.js';
import type { GraphStateFieldDefinitionType } from '../contracts/GraphStateFieldDefinition.js';
import type { LiteralTermType, TermType } from '../contracts/TripleStoreInterface.js';
import type { JsonValueType } from '../entities/json.js';
import { DAGError } from '../errors/DAGError.js';
import type { DAGLifecycleStateType } from '../lifecycle/DAGLifecycleState.js';

import { DagGraphTerms } from './DagGraphTerms.js';
import { GraphStateTerms } from './GraphStateTerms.js';

const GRAPH_HAS_STATE_CELL = GraphStateTerms.DAGONIZER.HasStateCell;
const GRAPH_KEY = GraphStateTerms.DAGONIZER.StateKey;
const GRAPH_STATE_VALUE = GraphStateTerms.DAGONIZER.StateValuePredicate;
const GRAPH_STATE_MEMBER = GraphStateTerms.DAGONIZER.StateMember;
const GRAPH_STATE_INDEX = GraphStateTerms.DAGONIZER.StateIndex;

/** Query facade for semantic execution-state fields and nested RDF values. */
export class GraphStateQueryService {
  readonly #dataset: GraphDatasetInterface;
  readonly #runIri: string;
  readonly #graph: ReturnType<typeof DagGraphTerms.namedNode>;

  constructor(dataset: GraphDatasetInterface, runIri: string) {
    this.#dataset = dataset;
    this.#runIri = runIri;
    this.#graph = DagGraphTerms.namedNode(GraphStateTerms.runGraphIri(runIri));
  }

  cellFor(key: string): ReturnType<typeof DagGraphTerms.namedNode> | undefined {
    const run = DagGraphTerms.namedNode(this.#runIri);
    const direct = this.#dataset.match({ "subject": run, "predicate": DagGraphTerms.namedNode(GraphStateTerms.stateFieldIri(key)), "graph": this.#graph }).next().value?.object;
    if (direct?.termType === 'NamedNode') return direct;
    const indexed = this.#dataset.match({ "subject": run, "predicate": DagGraphTerms.namedNode(GRAPH_HAS_STATE_CELL), "graph": this.#graph });
    for (const quad of indexed) {
      if (quad.object.termType === 'NamedNode' && this.#literalFor(quad.object, GRAPH_KEY) === key) return quad.object;
    }
    return undefined;
  }

  valueFor(key: string): JsonValueType | undefined {
    const cell = this.cellFor(key);
    return cell === undefined ? undefined : this.#valueFromCell(cell);
  }

  /** Return direct RDF objects for a subject/predicate query in this run graph. */
  objectsFor(subject: TermType, predicate: string): readonly TermType[] {
    return [...this.#dataset.match({ "subject": subject, "predicate": DagGraphTerms.namedNode(predicate), "graph": this.#graph })].map((quad) => quad.object);
  }

  /** Return direct bindings for a schema predicate without reconstructing JSON. */
  bindingsFor(predicate: string): readonly { readonly subject: TermType; readonly object: TermType }[] {
    return [...this.#dataset.match({ "predicate": DagGraphTerms.namedNode(predicate), "graph": this.#graph })]
      .map((quad) => ({ "subject": quad.subject, "object": quad.object }));
  }

  /** Return typed direct bindings using a schema-owned field definition. */
  bindingsForField(definition: GraphStateFieldDefinitionType): readonly { readonly subject: TermType; readonly object: TermType }[] {
    return this.bindingsFor(definition.predicate);
  }

  entries(): Map<string, JsonValueType> {
    const values = new Map<string, JsonValueType>();
    const run = DagGraphTerms.namedNode(this.#runIri);
    const cells = this.#dataset.match({ "subject": run, "predicate": DagGraphTerms.namedNode(GRAPH_HAS_STATE_CELL), "graph": this.#graph });
    for (const quad of cells) {
      if (quad.object.termType !== 'NamedNode') continue;
      const key = this.#literalFor(quad.object, GRAPH_KEY);
      const value = this.#valueFromCell(quad.object);
      if (key === undefined) continue;
      if (value !== undefined) {
        values.set(key, value);
        continue;
      }
    }
    return values;
  }

  lifecycle(): DAGLifecycleStateType | undefined {
    const run = DagGraphTerms.namedNode(this.#runIri);
    const current = this.#dataset.match({ "subject": run, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.CurrentLifecycle), "graph": this.#graph }).next().value?.object;
    const lifecycleSubject = current?.termType === 'NamedNode' ? current : run;
    const variant = this.#dataset.match({ "subject": lifecycleSubject, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.LifecycleVariant), "graph": this.#graph }).next().value?.object;
    if (variant?.termType !== 'NamedNode') return undefined;
    const startedAt = this.#numberFor(lifecycleSubject, GraphStateTerms.DAGONIZER.StartedAt);
    const finishedAt = this.#numberFor(lifecycleSubject, GraphStateTerms.DAGONIZER.FinishedAt);
    const reason = this.#literalFor(lifecycleSubject, GraphStateTerms.DAGONIZER.Reason);
    const correlationKey = this.#literalFor(lifecycleSubject, GraphStateTerms.DAGONIZER.CorrelationKey);
    const errorMessage = this.#literalFor(lifecycleSubject, GraphStateTerms.DAGONIZER.ErrorMessage);
    const errorPayload = this.#literalFor(lifecycleSubject, GraphStateTerms.DAGONIZER.ErrorPayload);
    const name = variant.value.slice(GraphStateTerms.DAGONIZER.namespace.length);
    if (name === 'pending' && startedAt === undefined && finishedAt === undefined && reason === undefined && correlationKey === undefined && errorMessage === undefined) return { "variant": 'pending', "startedAt": null, "finishedAt": null, "error": null, "reason": null, "correlationKey": null };
    if (name === 'running' && startedAt !== undefined && finishedAt === undefined && reason === undefined && correlationKey === undefined && errorMessage === undefined) return { "variant": 'running', startedAt, "finishedAt": null, "error": null, "reason": null, "correlationKey": null };
    if (name === 'awaiting-input' && startedAt !== undefined && finishedAt === undefined && correlationKey !== undefined && reason === undefined && errorMessage === undefined) return { "variant": 'awaiting-input', startedAt, "finishedAt": null, "error": null, "reason": null, correlationKey };
    if (name === 'completed' && startedAt !== undefined && finishedAt !== undefined && reason === undefined && correlationKey === undefined && errorMessage === undefined) return { "variant": 'completed', startedAt, finishedAt, "error": null, "reason": null, "correlationKey": null };
    if (name === 'cancelled' && startedAt !== undefined && finishedAt !== undefined && reason !== undefined && correlationKey === undefined && errorMessage === undefined) return { "variant": 'cancelled', startedAt, finishedAt, "error": null, reason, "correlationKey": null };
    if (name === 'timed_out' && startedAt !== undefined && finishedAt !== undefined && reason === undefined && correlationKey === undefined && errorMessage === undefined) return { "variant": 'timed_out', startedAt, finishedAt, "error": null, "reason": null, "correlationKey": null };
    if (name === 'failed' && startedAt !== undefined && finishedAt !== undefined && errorMessage !== undefined && reason === undefined && correlationKey === undefined) {
      let error: Error = new Error(errorMessage);
      if (errorPayload !== undefined) {
        try {
          const payload: unknown = JSON.parse(errorPayload);
          if (GraphStateQueryService.isRecord(payload) && payload['kind'] === 'DAGError' && typeof payload['code'] === 'string' && GraphStateQueryService.isRecord(payload['context'])) {
            error = new DAGError(errorMessage, { "code": payload['code'], "context": payload['context'], "retryable": payload['retryable'] === true });
          }
        } catch { /* malformed error payload falls back to its message */ }
      }
      return { "variant": 'failed', startedAt, finishedAt, "error": error, "reason": null, "correlationKey": null };
    }
    return undefined;
  }

  attemptCountFor(key: string): number | undefined {
    const attempt = DagGraphTerms.namedNode(GraphStateTerms.attemptIri(this.#runIri, key));
    return this.#numberFor(attempt, GraphStateTerms.DAGONIZER.AttemptCount);
  }

  #valueFromCell(cell: ReturnType<typeof DagGraphTerms.namedNode>): JsonValueType | undefined {
    const valueQuad = this.#dataset.match({ "subject": cell, "predicate": DagGraphTerms.namedNode(GRAPH_STATE_VALUE), "graph": this.#graph }).next().value;
    if (valueQuad === undefined) return undefined;
    if (valueQuad.object.termType === 'Literal') return GraphStateQueryService.valueFromLiteral(valueQuad.object);
    if (valueQuad.object.termType !== 'NamedNode') return undefined;
    if (valueQuad.object.value === GraphStateTerms.DAGONIZER.StateNull) return null;
    const type = this.#dataset.match({ "subject": valueQuad.object, "predicate": DagGraphTerms.namedNode(DagGraphTerms.RDF_TYPE), "graph": this.#graph }).next().value?.object;
    if (type?.termType !== 'NamedNode') return undefined;
    const members = [...this.#dataset.match({ "subject": valueQuad.object, "predicate": DagGraphTerms.namedNode(GRAPH_STATE_MEMBER), "graph": this.#graph })]
      .flatMap((quad) => quad.object.termType === 'NamedNode' ? [quad.object] : []);
    if (type.value === GraphStateTerms.DAGONIZER.StateArray) {
      return members.map((member) => ({
        'index': GraphStateQueryService.nonNegativeInteger(this.#literalFor(member, GRAPH_STATE_INDEX)),
        'value': this.#valueFromCell(member),
      })).filter((member): member is { index: number; value: JsonValueType } => member.index !== undefined && member.value !== undefined)
        .sort((left, right) => left.index - right.index).map((member) => member.value);
    }
    if (type.value === GraphStateTerms.DAGONIZER.StateObject) {
      const result: Record<string, JsonValueType> = {};
      for (const member of members) {
        const key = this.#literalFor(member, GRAPH_KEY);
        const value = this.#valueFromCell(member);
        if (key !== undefined && value !== undefined) result[key] = value;
      }
      return result;
    }
    return undefined;
  }

  #literalFor(subject: ReturnType<typeof DagGraphTerms.namedNode>, predicate: string): string | undefined {
    for (const quad of this.#dataset.match({ "subject": subject, "predicate": DagGraphTerms.namedNode(predicate), "graph": this.#graph })) {
      if (quad.object.termType === 'Literal') return quad.object.value;
    }
    return undefined;
  }

  #numberFor(subject: ReturnType<typeof DagGraphTerms.namedNode>, predicate: string): number | undefined {
    const value = this.#literalFor(subject, predicate);
    if (value === undefined) return undefined;
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }

  private static valueFromLiteral(literal: LiteralTermType): JsonValueType {
    const datatype = literal.datatype?.value;
    if (datatype === GraphStateTerms.XSD.boolean) return literal.value === 'true';
    if (datatype === GraphStateTerms.XSD.integer || datatype === GraphStateTerms.XSD.double) return Number(literal.value);
    return literal.value;
  }

  private static nonNegativeInteger(value: string | undefined): number | undefined {
    if (value === undefined) return undefined;
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : undefined;
  }

  private static isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
