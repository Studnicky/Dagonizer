import type { GraphDatasetInterface } from './contracts/GraphDatasetInterface.js';
import type { GraphDatasetProviderInterface, GraphScopeType } from './contracts/GraphDatasetProviderInterface.js';
import type { GraphStateDeltaInterface } from './contracts/GraphStateDeltaInterface.js';
import type { GraphStateFieldDefinitionType } from './contracts/GraphStateFieldDefinition.js';
import type { GraphStateJsonLdDocumentType } from './contracts/GraphStateJsonLd.js';
import type { GraphStateLifecycleInterface } from './contracts/GraphStateLifecycleInterface.js';
import type { GraphStateSnapshotInterface } from './contracts/GraphStateSnapshotInterface.js';
import type { QuadType } from './contracts/TripleStoreInterface.js';
import type { JsonValueType } from './entities/json.js';
import { JsonValue } from './entities/JsonValue.js';
import type { NodeErrorType } from './entities/node/NodeError.js';
import type { NodeWarningType } from './entities/node/NodeWarning.js';
import { DAGError } from './errors/DAGError.js';
import { DagGraphTerms } from './graph/DagGraphTerms.js';
import { GraphDatasetRevision } from './graph/GraphDatasetRevision.js';
import { GraphStateJsonLdCodec } from './graph/GraphStateJsonLdCodec.js';
import { GraphStateQueryService } from './graph/GraphStateQueryService.js';
import { GraphStateTerms } from './graph/GraphStateTerms.js';
import { InMemoryGraphDataset } from './graph/InMemoryGraphDataset.js';
import { DAGLifecycleMachine } from './lifecycle/DAGLifecycleMachine.js';
import type { DAGLifecycleStateType } from './lifecycle/DAGLifecycleState.js';
import { MetadataGetter } from './MetadataGetter.js';
import { Clock } from './runtime/Clock.js';
import { Validator } from './validation/Validator.js';

class DatasetForkProvider implements GraphDatasetProviderInterface {
    readonly #dataset: GraphDatasetInterface;
    constructor(dataset: GraphDatasetInterface) { this.#dataset = dataset; }
    root(_runIri: string): GraphDatasetInterface { return this.#dataset; }
    child(_parent: GraphScopeType, _child: GraphScopeType): GraphDatasetInterface {
        return this.#dataset.fork();
    }
    reopen(_runIri: string): undefined { return undefined; }
}

const GRAPH_HAS_STATE_CELL = GraphStateTerms.DAGONIZER.HasStateCell;
const GRAPH_KEY = GraphStateTerms.DAGONIZER.StateKey;
const GRAPH_STATE_VALUE = GraphStateTerms.DAGONIZER.StateValuePredicate;
const GRAPH_STATE_MEMBER = GraphStateTerms.DAGONIZER.StateMember;
const GRAPH_STATE_INDEX = GraphStateTerms.DAGONIZER.StateIndex;
const GRAPH_WARNING_PREFIX = `${GraphStateTerms.DAGONIZER.namespace}warning/`;
const GRAPH_ERROR_PREFIX = `${GraphStateTerms.DAGONIZER.namespace}error/`;

/**
 * Shared state flowing through all nodes in a flow.
 * Concrete implementations extend this for domain-specific state.
 *
 * State is the "clipboard" that all nodes read from and write to.
 * Errors are collected in state; they don't stop execution.
 *
 * The data fields (errors, warnings, metadata) mirror `NodeStateData`
 * (the graph projection exposed through the JSON-LD intermediate form).
 * The `lifecycle` field here carries an in-memory `Error` on the `failed`
 * branch, which is not JSON-expressible; `NodeStateData` holds the opaque
 * wire form. See `entities/node/NodeStateData.ts` for the persistence shape.
 */
export interface NodeStateInterface {
  /** Shared RDF dataset used by this node state and all lifecycle facts. */
  readonly graphDataset: GraphDatasetInterface;

  /** Bind the provider that mints isolated child datasets for this state. */
  bindGraphDatasetProvider(provider: GraphDatasetProviderInterface): void;

  /** Export the run graph as the Node.js JSON-LD intermediate representation. */
  snapshotJsonLd(runIri?: string): GraphStateJsonLdDocumentType;

  /** Restore this state from the context-bound JSON-LD graph document. */
  restoreJsonLd(runIri: string, document: GraphStateJsonLdDocumentType): Promise<void>;

  /** Stable IRI identifying this state’s execution run. */
  readonly runIri: string;

  /** Bind the state to the execution identity minted by the dispatcher. */
  bindRunIri(runIri: string): void;

  /** Record a placement lifecycle event in the run graph. */
  recordPlacementEvent(placementIri: string, event: string, output?: string): void;

  /**
   * Clone state for isolated execution (scatter clones).
   * Returns `this` so the concrete type is preserved across the interface
   * without requiring a cast at every call site.
   */
  clone(): this;

  /**
   * Collect an error in state. `context` is required on `NodeErrorType`
   * and always present; the engine stores errors without additional normalisation.
   */
  collectError(error: NodeErrorType): void;

  /**
   * Collect a warning in state.
   */
  collectWarning(warning: NodeWarningType): void;

  /**
   * Collected errors from all nodes.
   * Errors accumulate; they don't stop the flow.
   * At completion, caller decides what to do with them.
   */
  readonly 'errors': readonly NodeErrorType[];

  /**
   * Get a metadata value with type casting.
   */
  getMetadata(key: string): unknown;

  /**
   * Strict-typed reads over this state's metadata. `state.getter.string('url')`
   * narrows the `unknown` from `getMetadata` to a concrete type with a required
   * default — cast-free, never `undefined`. Use this in nodes instead of
   * narrowing `getMetadata` at the call site.
   */
  readonly 'getter': MetadataGetter;

  /**
   * Current DAG lifecycle state (full discriminated union).
   */
  readonly 'lifecycle': DAGLifecycleStateType;

  /**
   * Mark state as cancelled (terminal). Dispatched by the dispatcher (or a
   * cancellation supervisor) when an in-flight flow is aborted.
   */
  markCancelled(reason: string): void;

  /**
   * Mark state as completed (called by dispatcher at flow end).
   */
  markCompleted(): void;

  /**
   * Mark state as failed (terminal). Dispatched by the dispatcher when a
   * node throws; the original error is carried into the lifecycle.
   */
  markFailed(error: Error): void;

  /**
   * Mark state as running (called by dispatcher at flow start).
   */
  markRunning(): void;

  /**
   * Mark state as timed-out (terminal). Reserved for deadline enforcement
   * at the dispatcher tier.
   */
  markTimedOut(): void;

  /**
   * Transition lifecycle to `awaiting-input` (HITL park). The node calls
   * this before routing to the reserved `'parked'` output. The engine reads
   * the correlationKey from state metadata and surfaces it in
   * `ExecutionResultType.parked`. Stores `correlationKey` in state metadata
   * under the `'correlationKey'` key as a side-effect.
   */
  park(correlationKey: string): void;

  /**
   * True iff the lifecycle is in the `awaiting-input` (parked) state.
   * Use this in post-execution checks to determine whether the flow is
   * waiting for human input.
   */
  readonly 'parked': boolean;

  /**
   * Reset the lifecycle to `pending`. Called by the dispatcher before
   * re-entering a flow on resume when the prior run ended in a terminal
   * state (failed, cancelled, timed_out) due to a crash or interrupt.
   * Lifecycle is represented by graph facts; this method
   * resets it so `markRunning()` can transition `pending → running` again.
   */
  resetLifecycle(): void;

  /**
   * Generic metadata for routing decisions and node communication.
   */
  readonly 'metadata': Readonly<Record<string, unknown>>;

  /**
   * Set a metadata value. The value crosses the JSON-LD graph boundary and is
   * therefore required to be JSON-serialisable.
   *
   * The parameter type is `unknown` at the interface level because the schema-
   * derived scatter progress types carry `item: unknown` in their payload
   * fields (JSON Schema does not constrain item types). Callers are responsible
   * for ensuring values are JSON-safe before calling this method.
   */
  setMetadata(key: string, value: unknown): void;

  /**
   * Remove a metadata key. No-op when the key is absent.
   */
  deleteMetadata(key: string): void;

  /**
   * Record one retry attempt for a routing key (typically `context.nodeName`)
   * and return the new attempt count. A node that fails and wants the flow to
   * retry increments here; a downstream gate (or the same node on a self-loop)
   * reads the count to decide retry vs. salvage. Retry is a flow shape: the
   * count lives in state, the loop edge lives in the DAG. No `RetryPolicy`
   * hidden inside a node.
   */
  recordAttempt(key: string): number;

  /** Attempts recorded so far for `key` (0 when never recorded). */
  retriesFor(key: string): number;

  /**
   * Reset the attempt counter for `key`. Call on success so a placement that
   * is later re-entered (a loop, a reused embedded-DAG) starts fresh.
   */
  clearAttempts(key: string): void;

  /**
   * Record an attempt for `key` and report whether the budget allows another
   * try. `true` → route to a `retry` output (the DAG loops back); `false` →
   * route to `salvage`. Convenience over `recordAttempt` for the self-loop
   * shape. The counter is part of the snapshot, so the budget survives
   * checkpoint/resume.
   */
  withinRetryBudget(key: string, maxAttempts: number): boolean;

  /**
   * Collected warnings from all nodes.
   */
  readonly 'warnings': readonly NodeWarningType[];

  /** Graph-backed state implementation. */
}

export class NodeStateBase implements NodeStateInterface, GraphStateSnapshotInterface, GraphStateLifecycleInterface, GraphStateDeltaInterface {
    declare ['constructor']: new () => this;
    #dataset: GraphDatasetInterface;
    #graphDatasetProvider: GraphDatasetProviderInterface;
    #runIri: string;
    #lastSnapshotGraph: QuadType[] | undefined;
    #lastSnapshotRevision: string | undefined;
    #metadataProxy: Record<string, unknown>;
    // Strict-typed metadata reads (state.getter.string('k')). Constructed once
    // against this state so the public face is stable; reads route through the
    // graph-backed getMetadata operation.
    getter;
    constructor(dataset: GraphDatasetInterface = new InMemoryGraphDataset(), runIri: string = `urn:dagonizer/run/${globalThis.crypto.randomUUID()}`, graphDatasetProvider?: GraphDatasetProviderInterface) {
        this.#dataset = dataset;
        this.#runIri = runIri;
        this.#graphDatasetProvider = graphDatasetProvider ?? new DatasetForkProvider(dataset);
        this.getter = new MetadataGetter(this);
        this.#metadataProxy = new Proxy({}, {
            "get": (_target, key) => typeof key === 'string' ? this.getMetadata(key) : undefined,
            "set": (_target, key, value) => {
                if (typeof key !== 'string')
                    return false;
                this.setMetadata(key, value);
                return true;
            },
            "deleteProperty": (_target, key) => {
                if (typeof key !== 'string')
                    return false;
                this.deleteMetadata(key);
                return true;
            },
            "ownKeys": () => [...this.#values().keys()].filter((key) => key.startsWith('metadata.')).map((key) => key.slice('metadata.'.length)),
            "getOwnPropertyDescriptor": () => ({ 'enumerable': true, 'configurable': true }),
        });
        this.#ensureRunFact();
    }
    get graphDataset() {
        return this.#dataset;
    }
    bindGraphDatasetProvider(provider: GraphDatasetProviderInterface) {
        this.#graphDatasetProvider = provider;
    }
    async *snapshotGraph(runIri: string = this.#runIri) {
        this.#syncRuntimeFields();
        yield* this.#dataset.exportGraph(DagGraphTerms.namedNode(GraphStateTerms.runGraphIri(runIri)));
    }
    snapshotJsonLd(runIri: string = this.#runIri): GraphStateJsonLdDocumentType {
        this.#syncRuntimeFields();
        const quads = [...this.#dataset.exportGraph(DagGraphTerms.namedNode(GraphStateTerms.runGraphIri(runIri)))];
        return GraphStateJsonLdCodec.encode(quads);
    }
    async snapshotGraphDelta(runIri: string = this.#runIri) {
        this.#syncRuntimeFields();
        const current = [...this.#dataset.exportGraph(DagGraphTerms.namedNode(GraphStateTerms.runGraphIri(runIri)))];
        const previous = this.#lastSnapshotGraph ?? [];
        const baseRevision = this.#lastSnapshotRevision ?? GraphDatasetRevision.ofQuads([]);
        const revision = GraphDatasetRevision.ofQuads(current);
        const currentKeys = new Set(current.map(NodeStateBase.quadKey));
        const previousKeys = new Set(previous.map(NodeStateBase.quadKey));
        this.#lastSnapshotGraph = current;
        this.#lastSnapshotRevision = revision;
        return {
            "additions": current.filter((quad) => !previousKeys.has(NodeStateBase.quadKey(quad))),
            "deletions": previous.filter((quad) => !currentKeys.has(NodeStateBase.quadKey(quad))),
            baseRevision,
            revision,
        };
    }
    async restoreGraph(runIri: string, quads: AsyncIterable<QuadType>) {
        const graph = DagGraphTerms.namedNode(GraphStateTerms.runGraphIri(runIri));
        await this.#dataset.transactAsync(async (dataset) => {
            if (runIri !== this.#runIri)
                dataset.clearGraph(this.#graph());
            dataset.clearGraph(graph);
            await dataset.importGraphAsync(quads);
        });
        this.#runIri = runIri;
        this.#restoreRuntimeFields();
    }
    async restoreJsonLd(runIri: string, document: GraphStateJsonLdDocumentType) {
        const quads = GraphStateJsonLdCodec.rebase(GraphStateJsonLdCodec.decode(document), runIri);
        await this.restoreGraph(runIri, GraphStateJsonLdCodec.asyncQuads(quads));
    }
    get runIri() {
        return this.#runIri;
    }
    bindRunIri(runIri: string) {
        if (runIri === this.#runIri) {
            this.#ensureRunFact();
            return;
        }
        const previousGraph = this.#graph();
        if (this.#dataset.count({ "graph": previousGraph }) > 1)
            throw new Error('Node state identity is immutable after graph facts are written');
        this.#dataset.clearGraph(previousGraph);
        this.#runIri = runIri;
        this.#ensureRunFact();
    }
    closeGraph(closedAt: string = new Date().toISOString()) {
        const run = DagGraphTerms.namedNode(this.#runIri);
        const graph = this.#graph();
        const lifecycle = DagGraphTerms.namedNode(GraphStateTerms.lifecycleVariantIri(this.lifecycle.variant));
        this.#dataset.add([
            { "subject": graph, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.GraphStatus), "object": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.Closed), graph },
            { "subject": graph, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.ClosedAt), "object": DagGraphTerms.literal(closedAt, GraphStateTerms.XSD.dateTime), graph },
            { "subject": graph, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.LifecycleVariant), "object": lifecycle, graph },
            { "subject": run, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.Lifecycle), "object": lifecycle, graph },
        ]);
    }
    recordPlacementEvent(placementIri: string, event: string, output?: string) {
        const execution = DagGraphTerms.namedNode(GraphStateTerms.placementExecutionIri(this.#runIri, placementIri));
        const graph = this.#graph();
        this.#dataset.add([
            { "subject": execution, "predicate": DagGraphTerms.namedNode(DagGraphTerms.RDF_TYPE), "object": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.PlacementExecution), graph },
            { "subject": execution, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.PlacementPredicate), "object": DagGraphTerms.namedNode(placementIri), graph },
            { "subject": execution, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.LifecycleEvent), "object": DagGraphTerms.literal(event), graph },
        ]);
        if (output !== undefined) {
            this.#dataset.add([{ "subject": execution, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.Output), "object": DagGraphTerms.literal(output), graph }]);
        }
    }
    clone() {
        // Instantiate the actual (sub)class so declared domain fields start at
        // their normal defaults. State mapping applies domain data explicitly
        // after cloning; clone itself carries only shared metadata.
        const cloned = new this.constructor();
        const clonedRunIri = `${this.#runIri}/clone/${crypto.randomUUID()}`;
        cloned.#graphDatasetProvider = this.#graphDatasetProvider;
        cloned.#dataset = this.#graphDatasetProvider.child(
            { 'runIri': this.#runIri, 'dagIri': '', 'placementIri': '' },
            { 'runIri': clonedRunIri, 'dagIri': '', 'placementIri': '' },
        );
        cloned.#runIri = clonedRunIri;
        cloned.#ensureRunFact();
        for (const [key, value] of this.#values()) {
            if (key.startsWith('metadata.'))
                cloned.#write(key, value);
        }
        return cloned;
    }
    collectError(error: NodeErrorType) {
        // context is required on NodeErrorType; spread to a stable shape.
        this.#append(GRAPH_ERROR_PREFIX, JSON.stringify(error));
    }
    collectWarning(warning: NodeWarningType) {
        this.#append(GRAPH_WARNING_PREFIX, JSON.stringify(warning));
    }
    get errors() {
        return this.#records(GRAPH_ERROR_PREFIX).flatMap((value) => {
            const parsed = JSON.parse(value);
            return Validator.nodeError.is(parsed) ? [parsed] : [];
        });
    }
    getMetadata(key: string) {
        // Metadata holds heterogeneous JSON-serialisable values typed as `unknown`
        // at the boundary; callers narrow to the concrete shape they wrote.
        return this.#values().get(`metadata.${key}`);
    }
    /**
     * Current DAG lifecycle state (full discriminated union).
     */
    get lifecycle() {
        return this.#lifecycle() ?? DAGLifecycleMachine.initial();
    }
    markCancelled(reason: string) {
        this.#dispatch({ "type": 'cancel', reason, "at": Clock.monotonicMs() }, 'cancelled');
    }
    markCompleted() {
        this.#dispatch({ "type": 'succeed', "at": Clock.monotonicMs() }, 'completed');
    }
    markFailed(error: Error) {
        this.#dispatch({ "type": 'fail', error, "at": Clock.monotonicMs() }, 'failed');
    }
    markRunning() {
        this.#dispatch({ "type": 'start', "at": Clock.monotonicMs() }, 'running');
    }
    markTimedOut() {
        this.#dispatch({ "type": 'timeout', "at": Clock.monotonicMs() }, 'timed_out');
    }
    park(correlationKey: string) {
        this.#dispatch({ "type": 'park', correlationKey, "at": Clock.monotonicMs() }, 'awaiting-input');
        this.setMetadata('correlationKey', correlationKey);
    }
    get parked() {
        return DAGLifecycleMachine.isParked(this.lifecycle);
    }
    resetLifecycle() {
        this.#setLifecycle(DAGLifecycleMachine.initial());
    }
    get metadata() {
        // Returns the live backing record. The dotted-path accessor writes through
        // this reference (e.g. gather map strategy writes `metadata.result`), so
        // the returned object must be the same reference every call to preserve
        // write semantics: `state.metadata.result = value` must persist.
        return this.#metadataProxy;
    }
    setMetadata(key: string, value: unknown) {
        // Metadata stores heterogeneous JSON-serialisable values at the `unknown`
        // boundary; the assignment needs no narrowing.
        this.#write(`metadata.${key}`, JsonValue.from(value));
    }
    /** Read a JSON value stored in the run graph under a domain key. */
    protected getGraphStateField(key: string): JsonValueType | undefined {
        return this.#values().get(`domain.${key}`);
    }
    /** Write a JSON value into the run graph under a domain key. */
    protected setGraphStateField(key: string, value: unknown): void {
        this.#write(`domain.${key}`, JsonValue.from(value));
    }
    deleteMetadata(key: string) {
        this.#delete(`metadata.${key}`);
    }
    recordAttempt(key: string) {
        const next = this.retriesFor(key) + 1;
        const run = DagGraphTerms.namedNode(this.#runIri);
        const attempt = DagGraphTerms.namedNode(GraphStateTerms.attemptIri(this.#runIri, key));
        this.#dataset.transact((dataset) => {
            dataset.delete({ "subject": attempt, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.AttemptCount), "graph": this.#graph() });
            dataset.add([
                { "subject": run, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.Attempt), "object": attempt, "graph": this.#graph() },
                { "subject": attempt, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.AttemptKey), "object": DagGraphTerms.literal(key), "graph": this.#graph() },
                { "subject": attempt, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.AttemptCount), "object": DagGraphTerms.literal(String(next), GraphStateTerms.XSD.integer), "graph": this.#graph() },
            ]);
        });
        return next;
    }
    retriesFor(key: string) {
        const attempt = DagGraphTerms.namedNode(GraphStateTerms.attemptIri(this.#runIri, key));
        const count = this.#dataset.match({ "subject": attempt, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.AttemptCount), "graph": this.#graph() }).next().value?.object;
        if (count?.termType !== 'Literal') return 0;
        const value = Number(count.value);
        return Number.isFinite(value) ? value : 0;
    }
    clearAttempts(key: string) {
        const run = DagGraphTerms.namedNode(this.#runIri);
        const attempt = DagGraphTerms.namedNode(GraphStateTerms.attemptIri(this.#runIri, key));
        this.#dataset.transact((dataset) => {
            dataset.delete({ "subject": attempt, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.AttemptCount), "graph": this.#graph() });
            dataset.add([
                { "subject": run, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.Attempt), "object": attempt, "graph": this.#graph() },
                { "subject": attempt, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.AttemptKey), "object": DagGraphTerms.literal(key), "graph": this.#graph() },
                { "subject": attempt, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.AttemptCount), "object": DagGraphTerms.literal('0', GraphStateTerms.XSD.integer), "graph": this.#graph() },
            ]);
        });
    }
    withinRetryBudget(key: string, maxAttempts: number) {
        return this.recordAttempt(key) < maxAttempts;
    }
    get warnings() {
        return this.#records(GRAPH_WARNING_PREFIX).flatMap((value) => {
            const parsed = JSON.parse(value);
            return Validator.nodeWarning.is(parsed) ? [parsed] : [];
        });
    }
    #graph() {
        return DagGraphTerms.namedNode(GraphStateTerms.runGraphIri(this.#runIri));
    }
    #values() {
        return new GraphStateQueryService(this.#dataset, this.#runIri).entries();
    }
    #write(key: string, value: JsonValueType) {
        this.#dataset.transact(() => {
            const definition = this.#fieldDefinition(key);
            const field = DagGraphTerms.namedNode(definition?.predicate ?? GraphStateTerms.stateFieldIri(key));
            if (definition !== undefined) {
                if (definition.write === 'replace')
                    this.#dataset.delete({ "subject": DagGraphTerms.namedNode(this.#runIri), "predicate": field, "graph": this.#graph() });
                this.#projectDefinedValue(field, value, definition);
                return;
            }
            const cell = DagGraphTerms.namedNode(GraphStateTerms.stateCellIri(this.#runIri, key));
            this.#clearCell(cell);
            this.#dataset.add([
                { "subject": DagGraphTerms.namedNode(this.#runIri), "predicate": DagGraphTerms.namedNode(GRAPH_HAS_STATE_CELL), "object": cell, "graph": this.#graph() },
                { "subject": DagGraphTerms.namedNode(this.#runIri), "predicate": field, "object": cell, "graph": this.#graph() },
                { "subject": cell, "predicate": DagGraphTerms.namedNode(GRAPH_KEY), "object": DagGraphTerms.literal(key), "graph": this.#graph() },
            ]);
            this.#projectValue(cell, value, definition);
        });
    }
    #setLiteral(predicate: string, value: string) {
        this.#deletePredicate(predicate);
        this.#dataset.add([{ "subject": DagGraphTerms.namedNode(this.#runIri), "predicate": DagGraphTerms.namedNode(predicate), "object": DagGraphTerms.literal(value), "graph": this.#graph() }]);
    }
    #delete(key: string) {
        const definition = this.#fieldDefinition(key);
        if (definition !== undefined) {
            this.#dataset.delete({ "subject": DagGraphTerms.namedNode(this.#runIri), "predicate": DagGraphTerms.namedNode(definition.predicate), "graph": this.#graph() });
            return;
        }
        const cell = DagGraphTerms.namedNode(GraphStateTerms.stateCellIri(this.#runIri, key));
        this.#dataset.delete({ "subject": DagGraphTerms.namedNode(this.#runIri), "predicate": DagGraphTerms.namedNode(GRAPH_HAS_STATE_CELL), "object": cell, "graph": this.#graph() });
        this.#dataset.delete({ "subject": DagGraphTerms.namedNode(this.#runIri), "predicate": DagGraphTerms.namedNode(GraphStateTerms.stateFieldIri(key)), "object": cell, "graph": this.#graph() });
        this.#clearCell(cell);
    }
    #clearCell(cell: QuadType['subject']) {
        const prefix = `${cell.value}/`;
        for (const quad of [...this.#dataset.exportGraph(this.#graph())]) {
            if (quad.subject.termType === 'NamedNode' && (quad.subject.value === cell.value || quad.subject.value.startsWith(prefix)))
                this.#dataset.delete(quad);
        }
    }
    #projectValue(cell: QuadType['subject'], value: JsonValueType, definition?: GraphStateFieldDefinitionType) {
        const graph = this.#graph();
        const valuePredicate = DagGraphTerms.namedNode(GRAPH_STATE_VALUE);
        this.#dataset.add([{ "subject": cell, "predicate": DagGraphTerms.namedNode(DagGraphTerms.RDF_TYPE), "object": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.StateCell), graph }]);
        if (value === null) {
            this.#dataset.add([
                { "subject": cell, "predicate": valuePredicate, "object": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.StateNull), graph },
            ]);
            return;
        }
        if (typeof value === 'string') {
            this.#dataset.add([{ "subject": cell, "predicate": valuePredicate, "object": DagGraphTerms.literal(value, definition?.datatype), graph }]);
            return;
        }
        if (typeof value === 'boolean') {
            this.#dataset.add([{ "subject": cell, "predicate": valuePredicate, "object": DagGraphTerms.literal(String(value), definition?.datatype ?? GraphStateTerms.XSD.boolean), graph }]);
            return;
        }
        if (typeof value === 'number') {
            const datatype = definition?.datatype ?? (Number.isInteger(value) ? GraphStateTerms.XSD.integer : GraphStateTerms.XSD.double);
            this.#dataset.add([{ "subject": cell, "predicate": valuePredicate, "object": DagGraphTerms.literal(String(value), datatype), graph }]);
            return;
        }
        const valueNode = DagGraphTerms.namedNode(`${cell.value}/value`);
        const collectionType = Array.isArray(value) ? GraphStateTerms.DAGONIZER.StateArray : GraphStateTerms.DAGONIZER.StateObject;
        this.#dataset.add([
            { "subject": cell, "predicate": valuePredicate, "object": valueNode, graph },
            { "subject": valueNode, "predicate": DagGraphTerms.namedNode(DagGraphTerms.RDF_TYPE), "object": DagGraphTerms.namedNode(collectionType), graph },
        ]);
        if (Array.isArray(value)) {
            value.forEach((item, index) => {
                const member = DagGraphTerms.namedNode(`${valueNode.value}/item/${index}`);
                this.#dataset.add([
                    { "subject": valueNode, "predicate": DagGraphTerms.namedNode(GRAPH_STATE_MEMBER), "object": member, graph },
                    { "subject": member, "predicate": DagGraphTerms.namedNode(GRAPH_STATE_INDEX), "object": DagGraphTerms.literal(String(index), GraphStateTerms.XSD.integer), graph },
                ]);
                this.#projectValue(member, item);
            });
            return;
        }
        for (const [key, item] of Object.entries(value)) {
            const member = DagGraphTerms.namedNode(`${valueNode.value}/property/${encodeURIComponent(key)}`);
            this.#dataset.add([
                { "subject": valueNode, "predicate": DagGraphTerms.namedNode(GRAPH_STATE_MEMBER), "object": member, graph },
                { "subject": valueNode, "predicate": DagGraphTerms.namedNode(definition?.nested?.[key]?.predicate ?? GraphStateTerms.nestedFieldIri(key)), "object": member, graph },
                { "subject": cell, "predicate": DagGraphTerms.namedNode(definition?.nested?.[key]?.predicate ?? GraphStateTerms.nestedFieldIri(key)), "object": member, graph },
                { "subject": member, "predicate": DagGraphTerms.namedNode(GRAPH_KEY), "object": DagGraphTerms.literal(key), graph },
            ]);
            this.#projectValue(member, item);
        }
    }
    #projectDefinedValue(field: QuadType['predicate'], value: JsonValueType, definition: GraphStateFieldDefinitionType) {
        const graph = this.#graph();
        if (value === null) {
            this.#dataset.add([{ "subject": DagGraphTerms.namedNode(this.#runIri), "predicate": field, "object": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.StateNull), graph }]);
            return;
        }
        if (typeof value !== 'object' || Array.isArray(value)) {
            if (Array.isArray(value)) {
                if (definition.cardinality === 'many') {
                    value.forEach((item, index) => {
                        const itemNode = DagGraphTerms.namedNode(`${this.#runIri}/field/${encodeURIComponent(field.value)}/item/${index}`);
                        this.#dataset.add([{ "subject": DagGraphTerms.namedNode(this.#runIri), "predicate": field, "object": itemNode, graph }]);
                        this.#projectValue(itemNode, item);
                    });
                }
                else {
                    const valueNode = DagGraphTerms.namedNode(`${this.#runIri}/field/${encodeURIComponent(field.value)}/value`);
                    this.#dataset.add([{ "subject": DagGraphTerms.namedNode(this.#runIri), "predicate": field, "object": valueNode, graph }]);
                    this.#projectValue(valueNode, value, definition);
                }
                return;
            }
            const datatype = definition.datatype ?? (typeof value === 'boolean' ? GraphStateTerms.XSD.boolean : typeof value === 'number' ? (Number.isInteger(value) ? GraphStateTerms.XSD.integer : GraphStateTerms.XSD.double) : undefined);
            this.#dataset.add([{ "subject": DagGraphTerms.namedNode(this.#runIri), "predicate": field, "object": DagGraphTerms.literal(String(value), datatype), graph }]);
            return;
        }
        const valueNode = DagGraphTerms.namedNode(`${this.#runIri}/field/${encodeURIComponent(field.value)}`);
        this.#dataset.add([{ "subject": DagGraphTerms.namedNode(this.#runIri), "predicate": field, "object": valueNode, graph }]);
        for (const [key, item] of Object.entries(value)) {
            const nested = definition.nested?.[key];
            if (nested === undefined)
                continue;
            const predicate = DagGraphTerms.namedNode(nested.predicate);
            const datatype = nested.datatype ?? (typeof item === 'boolean' ? GraphStateTerms.XSD.boolean : typeof item === 'number' ? (Number.isInteger(item) ? GraphStateTerms.XSD.integer : GraphStateTerms.XSD.double) : undefined);
            this.#dataset.add([{ "subject": valueNode, "predicate": predicate, "object": DagGraphTerms.literal(String(item), datatype), graph }]);
        }
    }
    #deletePredicate(predicate: string) {
        this.#dataset.delete({ "subject": DagGraphTerms.namedNode(this.#runIri), "predicate": DagGraphTerms.namedNode(predicate), "graph": this.#graph() });
    }
    #fieldDefinition(key: string) {
        return this.graphStateFields().find((field) => field.key === key || field.key === key.slice('domain.'.length));
    }
    #append(prefix: string, value: string) {
        this.#setLiteral(`${prefix}${this.#records(prefix).length}`, value);
    }
    #records(prefix: string) {
        const records = [];
        for (const quad of this.#dataset.match({ "subject": DagGraphTerms.namedNode(this.#runIri), "graph": this.#graph() })) {
            if (quad.predicate.termType === 'NamedNode' && quad.object.termType === 'Literal' && quad.predicate.value.startsWith(prefix))
                records.push(quad.object.value);
        }
        return records;
    }
    #lifecycle() {
        return new GraphStateQueryService(this.#dataset, this.#runIri).lifecycle();
    }
    #setLifecycle(lifecycle: DAGLifecycleStateType) {
        const error = lifecycle.error === null ? null : lifecycle.error instanceof DAGError
            ? { "kind": 'DAGError', "name": lifecycle.error.name, "message": lifecycle.error.message, "code": lifecycle.error.code, "context": lifecycle.error.context, "retryable": lifecycle.error.retryable }
            : { "kind": 'Error', "name": lifecycle.error.name, "message": lifecycle.error.message };
        const run = DagGraphTerms.namedNode(this.#runIri);
        const graph = this.#graph();
        const event = DagGraphTerms.namedNode(`${this.#runIri}/lifecycle/${Date.now()}-${globalThis.crypto.randomUUID()}`);
        this.#dataset.transact((dataset) => {
        const facts: QuadType[] = [
                { "subject": run, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.LifecycleEvent), "object": event, graph },
                { "subject": event, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.LifecycleVariant), "object": DagGraphTerms.namedNode(GraphStateTerms.lifecycleVariantIri(lifecycle.variant)), graph },
            ];
            if (lifecycle.startedAt !== null)
                facts.push({ "subject": event, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.StartedAt), "object": DagGraphTerms.literal(String(lifecycle.startedAt), GraphStateTerms.XSD.double), graph });
            if (lifecycle.finishedAt !== null)
                facts.push({ "subject": event, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.FinishedAt), "object": DagGraphTerms.literal(String(lifecycle.finishedAt), GraphStateTerms.XSD.double), graph });
            if (lifecycle.reason !== null)
                facts.push({ "subject": event, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.Reason), "object": DagGraphTerms.literal(lifecycle.reason), graph });
            if (lifecycle.correlationKey !== null)
                facts.push({ "subject": event, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.CorrelationKey), "object": DagGraphTerms.literal(lifecycle.correlationKey), graph });
            if (error !== null)
                facts.push({ "subject": event, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.ErrorMessage), "object": DagGraphTerms.literal(error.message), graph }, { "subject": event, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.ErrorPayload), "object": DagGraphTerms.literal(JSON.stringify(error)), graph });
            dataset.delete({ "subject": run, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.CurrentLifecycle), graph });
            facts.push({ "subject": run, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.CurrentLifecycle), "object": event, graph });
            dataset.add(facts);
        });
    }
    #ensureRunFact() {
        const pattern = {
            "subject": DagGraphTerms.namedNode(this.#runIri),
            "predicate": DagGraphTerms.namedNode(DagGraphTerms.RDF_TYPE),
            "object": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.Run),
            "graph": this.#graph(),
        };
        if (this.#dataset.ask(pattern))
            return;
        const graph = this.#graph();
        const run = DagGraphTerms.namedNode(this.#runIri);
        this.#dataset.add([
            { "subject": run, "predicate": DagGraphTerms.namedNode(DagGraphTerms.RDF_TYPE), "object": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.Run), graph },
            { "subject": graph, "predicate": DagGraphTerms.namedNode(DagGraphTerms.RDF_TYPE), "object": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.RunDetail), graph },
            { "subject": graph, "predicate": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.RetentionClass), "object": DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.Transient), graph },
        ]);
    }
    static quadKey(quad: QuadType): string {
        return JSON.stringify(quad);
    }
    #dispatch(event: Parameters<typeof DAGLifecycleMachine.transition>[1], targetVariant: string) {
        try {
            this.#setLifecycle(DAGLifecycleMachine.transition(this.lifecycle, event));
        }
        catch {
            throw new DAGError(`Cannot mark ${targetVariant}: lifecycle is ${this.lifecycle.variant}`);
        }
    }
    /** JSON-LD graph fields are the only domain-state boundary. */
    protected graphStateFields(): readonly GraphStateFieldDefinitionType[] { return []; }

    #syncRuntimeFields(): void {
        for (const key of Object.keys(this)) {
            if (key === 'getter') continue;
            this.#write(`domain.${key}`, JsonValue.from(this.graphStateValue(key, Reflect.get(this, key))));
        }
    }

    /** Normalize a runtime field into the JSON-shaped value stored in the graph. */
    protected graphStateValue(_key: string, value: unknown): unknown { return value; }

    #restoreRuntimeFields(): void {
        for (const [key, value] of this.#values()) {
            if (!key.startsWith('domain.')) continue;
            const property = key.slice('domain.'.length);
            if (property.length > 0) Reflect.set(this, property, value);
        }
    }

}
//# sourceMappingURL=NodeStateBase.js.map
