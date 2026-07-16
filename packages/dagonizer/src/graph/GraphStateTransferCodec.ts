import type * as RDF from '@rdfjs/types';
import { DataFactory, Parser, Writer } from 'n3';

import type { GraphStateSnapshotReferenceType } from '../contracts/GraphStateSnapshotReference.js';
import type { GraphStateTransferLeaseType } from '../contracts/GraphStateTransferLease.js';
import type { GraphStateTransferIdentityType } from '../contracts/GraphStateTransferMetadata.js';
import type { GraphStateTransferStoreInterface } from '../contracts/GraphStateTransferStoreInterface.js';
import type { LiteralTermType, QuadType, TermType } from '../contracts/TripleStoreInterface.js';
import type { GraphStateDeltaReferenceType, GraphStateInlineDeltaType, GraphStateInlineType, GraphStateReferenceType, GraphStateSharedType, GraphStateTransferType } from '../entities/executor/GraphStateTransferSchema.js';

import { DagGraphTerms } from './DagGraphTerms.js';
import { GraphDatasetRevision } from './GraphDatasetRevision.js';
import { GraphStateTerms } from './GraphStateTerms.js';

/** One batch item's quad stream tagged with the run IRI whose state graph it fills. */
export type GraphStateTransferItemType = {
  readonly runIri: string;
  readonly quads: AsyncIterable<QuadType>;
}

/** One batch item's additions/deletions streams for a combined batch delta. */
export type GraphStateTransferDeltaItemType = {
  readonly runIri: string;
  readonly additions: Iterable<QuadType>;
  readonly deletions: Iterable<QuadType>;
}

/** One batch item's decoded subgraph, partitioned out of a combined payload. */
export type GraphStateTransferPartType = {
  readonly id: string;
  readonly runIri: string;
  readonly quads: AsyncIterable<QuadType>;
}

/** RDF 1.2-aware codec for graph-state transfer envelopes. */
export class GraphStateTransferCodec {
  static encode(quads: Iterable<QuadType>): string {
    const writer = new Writer<RDF.Quad>({ "format": 'N-Quads' });
    return writer.quadsToString([...quads].map(GraphStateTransferCodec.toRdfQuad));
  }

  static decode(input: string): QuadType[] {
    const parser = new Parser({ "format": 'N-Quads', "factory": DataFactory });
    return parser.parse(input).map(GraphStateTransferCodec.quadOf);
  }

  static async *encodeStream(quads: AsyncIterable<QuadType>, onQuad?: () => void): AsyncIterable<string> {
    const chunks: string[] = [];
    let readIndex = 0;
    const outputStream = {
      write(chunk: string, _encoding: string, done?: () => void): void {
        chunks.push(chunk);
        done?.();
      },
      end(done?: (error: null, output?: string) => void): void {
        done?.(null, '');
      },
    };
    const writer = new Writer<RDF.Quad>(outputStream, { 'format': 'N-Quads', 'end': false });
    for await (const quad of quads) {
      writer.addQuad(GraphStateTransferCodec.toRdfQuad(quad));
      onQuad?.();
      while (readIndex < chunks.length) {
        const chunk = chunks[readIndex++];
        if (chunk !== undefined) yield chunk;
      }
      chunks.length = 0;
      readIndex = 0;
    }
    writer.end();
    while (readIndex < chunks.length) {
      const chunk = chunks[readIndex++];
      if (chunk !== undefined) yield chunk;
    }
  }

  /**
   * Combine every batch item's quad stream into ONE inline N-Quads payload with
   * a single encode + single hash. Each item's quads already carry its own
   * `${runIri}#state` graph term, so the union partitions cleanly on decode.
   * Reuses `encodeStream`/`transferHash` — pays the codec cost once per batch,
   * not per item.
   */
  static async inline(items: readonly GraphStateTransferItemType[]): Promise<GraphStateInlineType> {
    const chunks: string[] = [];
    let quadCount = 0;
    let byteSize = 0;
    const encoder = new TextEncoder();
    for await (const chunk of GraphStateTransferCodec.encodeStream(GraphStateTransferCodec.#mergeStreams(items), () => { quadCount += 1; })) {
      chunks.push(chunk);
      byteSize += encoder.encode(chunk).byteLength;
    }
    const nquads = chunks.join('');
    return {
      'transport': 'inline-nquads',
      'format': 'application/n-quads',
      'nquads': nquads,
      'graphIris': items.map((item) => GraphStateTerms.runGraphIri(item.runIri)),
      'hash': GraphStateTransferCodec.transferHash(nquads, ''),
      'byteSize': byteSize,
      'quadCount': quadCount,
    };
  }

  /**
   * Synchronous inline combine from already-materialized quad iterables. Used by
   * the synchronous `DagTask.toRequest()` seam to build a valid inline batch
   * payload (typically empty — the real payload is combined asynchronously by the
   * container from the live graph stream). One encode + one hash, like `inline`.
   */
  static inlineSync(items: readonly { readonly runIri: string; readonly quads: Iterable<QuadType> }[]): GraphStateInlineType {
    const all: QuadType[] = [];
    for (const item of items) for (const quad of item.quads) all.push(quad);
    const nquads = GraphStateTransferCodec.encode(all);
    return {
      'transport': 'inline-nquads',
      'format': 'application/n-quads',
      'nquads': nquads,
      'graphIris': items.map((item) => GraphStateTerms.runGraphIri(item.runIri)),
      'hash': GraphStateTransferCodec.transferHash(nquads, ''),
      'byteSize': new TextEncoder().encode(nquads).byteLength,
      'quadCount': all.length,
    };
  }

  /**
   * Combine every batch item's graph into the store with ONE bulk write, yielding
   * a single `graph-ref` batch transfer for the whole batch. The combined
   * multi-graph stream is written through `putSnapshot` once (the adapter sees the
   * entire batch and can bulk-insert); the returned reference addresses every
   * item's graph. One hash covers the combined payload.
   */
  static async reference(
    store: GraphStateTransferStoreInterface,
    items: readonly GraphStateTransferItemType[],
    identity: GraphStateTransferIdentityType,
  ): Promise<GraphStateReferenceType> {
    const graphIris = items.map((item) => GraphStateTerms.runGraphIri(item.runIri));
    const hashState = { 'chunks': [] as string[] };
    let byteSize = 0;
    let quadCount = 0;
    const reference: GraphStateSnapshotReferenceType = {
      'reference': `batch-snapshot:${globalThis.crypto.randomUUID()}`,
      'format': 'application/n-quads',
      'graphIris': [...graphIris],
      'hash': 'pending',
      'dagIri': identity.dagIri,
      'placementPath': [...identity.placementPath],
      'placementIri': identity.placementIri,
      'stateGraphIri': graphIris[0] ?? `${identity.placementIri}#batch`,
      'createdAt': new Date().toISOString(),
      'byteSize': 0,
      'quadCount': 0,
    };
    const stored = await store.putSnapshot(GraphStateTransferCodec.hashingStream(GraphStateTransferCodec.#mergeStreams(items), hashState, (bytes) => { byteSize += bytes; quadCount += 1; }), reference);
    return {
      'transport': 'graph-ref',
      'format': 'application/n-quads',
      'graphIris': [...stored.graphIris],
      'graphSnapshotRef': stored.reference,
      'hash': GraphStateTransferCodec.digestOf(hashState),
      'byteSize': byteSize,
      'quadCount': quadCount,
    };
  }

  /**
   * Combine every batch item's graph into ONE shared-endpoint write under a
   * single lease covering every item graph. The combined multi-graph stream is
   * written through `writeShared` once, so the whole batch lands in one bulk op.
   */
  static async shared(
    store: GraphStateTransferStoreInterface,
    items: readonly GraphStateTransferItemType[],
    ttlMs: number,
  ): Promise<GraphStateSharedType> {
    const graphIris = items.map((item) => GraphStateTerms.runGraphIri(item.runIri));
    const lease = await store.acquireLease(graphIris, ttlMs);
    const quads: QuadType[] = [];
    for await (const quad of GraphStateTransferCodec.#mergeStreams(items)) quads.push(quad);
    await store.writeShared(lease, GraphStateTransferCodec.iterableToAsync(quads));
    return {
      'transport': 'shared-endpoint',
      'graphIris': [...lease.graphIris],
      'endpoint': lease.endpoint,
      'lease': lease.token,
      'byteSize': new TextEncoder().encode(GraphStateTransferCodec.encode(quads)).byteLength,
      'quadCount': quads.length,
    };
  }

  /**
   * Combine every batch item's delta into ONE additions/deletions N-Quads batch
   * delta with a single hash. `reference` selects the `delta-ref` transport (the
   * `baseSnapshotRef` names a store-held base) versus inline `inline-delta-nquads`.
   *
   * Per-run revisions are intentionally NOT carried on the batch: scatter clones
   * are ephemeral (created → transferred → run → transferred back) with no
   * concurrent-drift window, and the container restore path applies the
   * additions directly without a compare-and-swap.
   */
  static delta(
    items: readonly GraphStateTransferDeltaItemType[],
    baseSnapshotRef: string,
    options: { readonly reference?: boolean } = {},
  ): GraphStateInlineDeltaType | GraphStateDeltaReferenceType {
    const additionsQuads: QuadType[] = [];
    const deletionsQuads: QuadType[] = [];
    for (const item of items) {
      for (const quad of item.additions) additionsQuads.push(quad);
      for (const quad of item.deletions) deletionsQuads.push(quad);
    }
    const additions = GraphStateTransferCodec.encode(additionsQuads);
    const deletions = GraphStateTransferCodec.encode(deletionsQuads);
    const shared = {
      'graphIris': items.map((item) => GraphStateTerms.runGraphIri(item.runIri)),
      'baseSnapshotRef': baseSnapshotRef,
      'additions': additions,
      'deletions': deletions,
      'hash': GraphStateTransferCodec.transferHash(additions, deletions),
      'byteSize': new TextEncoder().encode(additions + deletions).byteLength,
      'quadCount': additionsQuads.length,
    } as const;
    if (options.reference === true) return { 'transport': 'delta-ref', ...shared };
    return { 'transport': 'inline-delta-nquads', ...shared };
  }

  /**
   * Split a combined batch transfer of ANY mode back into per-item subgraphs,
   * reading/decoding the combined payload ONCE and partitioning by graph term so
   * each item `{ id, runIri }` receives exactly its `${runIri}#state` quads.
   * Callers restore each via `snapshot.restoreGraph(part.runIri, part.quads)`.
   * Store-backed modes (`graph-ref`, `shared-endpoint`) read the whole batch from
   * the store once; delta modes apply the combined additions. Integrity hashes are
   * verified once per batch. An item that contributed no quads yields an empty
   * stream (its state graph is cleared on restore).
   */
  static async restore(
    transfer: GraphStateTransferType,
    items: readonly { readonly id: string; readonly runIri: string }[],
    store: GraphStateTransferStoreInterface | null,
  ): Promise<GraphStateTransferPartType[]> {
    if (transfer.transport === 'inline-nquads') {
      if (GraphStateTransferCodec.transferHash(transfer.nquads, '') !== transfer.hash) throw new Error('Graph transfer integrity hash mismatch');
      return GraphStateTransferCodec.#partition(GraphStateTransferCodec.decode(transfer.nquads), items);
    }
    if (transfer.transport === 'inline-delta-nquads' || transfer.transport === 'delta-ref') {
      if (GraphStateTransferCodec.transferHash(transfer.additions, transfer.deletions) !== transfer.hash) throw new Error('Graph transfer integrity hash mismatch');
      return GraphStateTransferCodec.#partition(GraphStateTransferCodec.decode(transfer.additions), items);
    }
    if (transfer.transport === 'graph-ref') {
      if (store === null) throw new Error('Graph snapshot reference transfer requires a graph transfer store');
      return GraphStateTransferCodec.#partition(await GraphStateTransferCodec.#readVerified(store.readSnapshot(transfer.graphSnapshotRef), transfer.hash), items);
    }
    if (store === null) throw new Error('Shared graph transfer requires a graph transfer store');
    const lease: GraphStateTransferLeaseType = { 'endpoint': transfer.endpoint, 'token': transfer.lease, 'graphIris': [...transfer.graphIris], 'expiresAt': Number.POSITIVE_INFINITY };
    const quads: QuadType[] = [];
    for await (const quad of store.readShared(lease, transfer.graphIris)) quads.push(quad);
    return GraphStateTransferCodec.#partition(quads, items);
  }

  static revision(quads: Iterable<QuadType>): string {
    return GraphDatasetRevision.ofQuads(quads);
  }

  static async discard(store: GraphStateTransferStoreInterface, reference: string): Promise<void> {
    await store.deleteSnapshot(reference);
  }

  static async *asyncQuads(
    quads: AsyncIterable<QuadType>,
  ): AsyncIterable<QuadType> {
    yield* quads;
  }

  private static async *iterableToAsync(
    quads: Iterable<QuadType>,
  ): AsyncIterable<QuadType> {
    for (const quad of quads) {
      yield quad;
    }
  }

  private static toRdfQuad(quad: QuadType): RDF.Quad {
    return DataFactory.quad(
      GraphStateTransferCodec.toRdfSubject(quad.subject),
      GraphStateTransferCodec.toRdfPredicate(quad.predicate),
      GraphStateTransferCodec.toRdfObject(quad.object),
      GraphStateTransferCodec.toRdfGraph(quad.graph),
    );
  }

  private static toRdfSubject(term: TermType): RDF.Quad_Subject {
    if (term.termType === 'NamedNode') return DataFactory.namedNode(term.value);
    if (term.termType === 'BlankNode') return DataFactory.blankNode(term.value);
    if (term.termType === 'Variable') return DataFactory.variable(term.value);
    if (term.termType === 'Quad') return GraphStateTransferCodec.toRdfQuad(term.quad);
    throw new Error(`Invalid RDF subject term '${term.termType}'`);
  }

  private static toRdfPredicate(term: TermType): RDF.Quad_Predicate {
    if (term.termType === 'NamedNode') return DataFactory.namedNode(term.value);
    if (term.termType === 'Variable') return DataFactory.variable(term.value);
    throw new Error(`Invalid RDF predicate term '${term.termType}'`);
  }

  private static toRdfObject(term: TermType): RDF.Quad_Object {
    if (term.termType === 'Quad') return GraphStateTransferCodec.toRdfQuad(term.quad);
    if (term.termType === 'NamedNode') return DataFactory.namedNode(term.value);
    if (term.termType === 'BlankNode') return DataFactory.blankNode(term.value);
    if (term.termType === 'Variable') return DataFactory.variable(term.value);
    if (term.termType === 'Literal') return GraphStateTransferCodec.toRdfLiteral(term);
    throw new Error('Invalid RDF object term DefaultGraph');
  }

  private static toRdfLiteral(term: LiteralTermType): RDF.Literal {
    if (term.language !== undefined) return DataFactory.literal(term.value, term.language);
    return DataFactory.literal(term.value, term.datatype === undefined ? undefined : DataFactory.namedNode(term.datatype.value));
  }

  private static toRdfGraph(term: TermType): RDF.Quad_Graph {
    if (term.termType === 'NamedNode') return DataFactory.namedNode(term.value);
    if (term.termType === 'BlankNode') return DataFactory.blankNode(term.value);
    if (term.termType === 'Variable') return DataFactory.variable(term.value);
    if (term.termType === 'DefaultGraph') return DataFactory.defaultGraph();
    throw new Error(`Invalid RDF graph term '${term.termType}'`);
  }

  private static quadOf(quad: RDF.BaseQuad): QuadType {
    return {
      "subject": GraphStateTransferCodec.termOf(quad.subject),
      "predicate": GraphStateTransferCodec.termOf(quad.predicate),
      "object": GraphStateTransferCodec.termOf(quad.object),
      "graph": GraphStateTransferCodec.termOf(quad.graph),
    };
  }

  private static termOf(term: RDF.Term): TermType {
    if (term.termType === 'Quad') return { "termType": 'Quad', "value": '', "quad": GraphStateTransferCodec.quadOf(term) };
    if (term.termType === 'Literal') {
      if (term.language.length > 0) return { "termType": 'Literal', "value": term.value, "language": term.language };
      if (term.datatype.value !== DagGraphTerms.XSD_STRING) return { "termType": 'Literal', "value": term.value, "datatype": { "termType": 'NamedNode', "value": term.datatype.value } };
      return { "termType": 'Literal', "value": term.value };
    }
    return { "termType": term.termType, "value": term.value };
  }

  private static async *hashingStream(
    quads: AsyncIterable<QuadType>,
    hashState: { chunks: string[] },
    onQuad: (byteSize: number) => void,
  ): AsyncIterable<QuadType> {
    const encoder = new TextEncoder();
    let byteSize = 0;
    const outputStream = {
      write(chunk: string, _encoding: string, done?: () => void): void {
        hashState.chunks.push(chunk);
        byteSize += encoder.encode(chunk).byteLength;
        done?.();
      },
      end(done?: (error: null, output?: string) => void): void {
        done?.(null, '');
      },
    };
    const writer = new Writer<RDF.Quad>(outputStream, { 'format': 'N-Quads', 'end': false });
    for await (const quad of quads) {
      const before = byteSize;
      writer.addQuad(GraphStateTransferCodec.toRdfQuad(quad));
      onQuad(byteSize - before);
      yield quad;
    }
    writer.end();
  }

  private static digestOf(hashState: { chunks: string[] }): string {
    return `sha256-${GraphDatasetRevision.sha256(`${hashState.chunks.join('')} `)}`;
  }

  static async #readVerified(quads: AsyncIterable<QuadType>, expectedHash: string): Promise<QuadType[]> {
    const hashState = { 'chunks': [] as string[] };
    const collected: QuadType[] = [];
    for await (const quad of GraphStateTransferCodec.hashingStream(quads, hashState, () => undefined)) collected.push(quad);
    if (GraphStateTransferCodec.digestOf(hashState) !== expectedHash) throw new Error('Graph transfer integrity hash mismatch');
    return collected;
  }

  static async *#mergeStreams(items: readonly GraphStateTransferItemType[]): AsyncIterable<QuadType> {
    for (const item of items) yield* item.quads;
  }

  static #partition(
    quads: readonly QuadType[],
    items: readonly { readonly id: string; readonly runIri: string }[],
  ): GraphStateTransferPartType[] {
    const byGraph = new Map<string, QuadType[]>();
    for (const quad of quads) {
      const bucket = byGraph.get(quad.graph.value);
      if (bucket === undefined) byGraph.set(quad.graph.value, [quad]);
      else bucket.push(quad);
    }
    return items.map((item) => ({
      'id': item.id,
      'runIri': item.runIri,
      'quads': GraphStateTransferCodec.iterableToAsync(byGraph.get(GraphStateTerms.runGraphIri(item.runIri)) ?? []),
    }));
  }

  private static hash(value: string): string {
    return `sha256-${GraphDatasetRevision.sha256(value)}`;
  }

  private static transferHash(additions: string, deletions: string): string {
    return GraphStateTransferCodec.hash(`${additions} ${deletions}`);
  }
}
