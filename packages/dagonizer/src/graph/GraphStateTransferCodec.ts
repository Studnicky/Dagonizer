import { createHash } from 'node:crypto';

import type * as RDF from '@rdfjs/types';
import { DataFactory, Parser, Writer } from 'n3';

import type { GraphDatasetInterface } from '../contracts/GraphDatasetInterface.js';
import type { GraphStateSnapshotInterface } from '../contracts/GraphStateSnapshotInterface.js';
import type { GraphStateSnapshotReferenceType } from '../contracts/GraphStateSnapshotReference.js';
import type { GraphStateTransferType } from '../contracts/GraphStateTransfer.js';
import type { GraphStateTransferLeaseType } from '../contracts/GraphStateTransferLease.js';
import type { GraphStateTransferIdentityType, GraphStateTransferMetadataType } from '../contracts/GraphStateTransferMetadata.js';
import type { GraphStateTransferStoreInterface } from '../contracts/GraphStateTransferStoreInterface.js';
import type { LiteralTermType, QuadType, TermType } from '../contracts/TripleStoreInterface.js';

import { DagGraphTerms } from './DagGraphTerms.js';
import { GraphDatasetRevision } from './GraphDatasetRevision.js';
import { GraphStateJsonLdCodec } from './GraphStateJsonLdCodec.js';

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

  static inline(
    runIri: string,
    graphIris: readonly string[],
    quads: Iterable<QuadType>,
    identity: GraphStateTransferIdentityType,
  ): Extract<GraphStateTransferType, { readonly mode: 'inline-nquads' }> {
    const materialized = [...quads];
    const nquads = GraphStateTransferCodec.encode(materialized);
    const metadata: GraphStateTransferMetadataType = {
      "dagIri": identity.dagIri,
      "placementPath": [...identity.placementPath],
      "placementIri": identity.placementIri,
      "stateGraphIri": identity.stateGraphIri ?? graphIris[0] ?? `${runIri}#state`,
      "createdAt": new Date().toISOString(),
      "byteSize": new TextEncoder().encode(nquads).byteLength,
      "quadCount": materialized.length,
      "jsonLd": identity.jsonLd,
    };
    return {
      "mode": 'inline-nquads',
      "format": 'application/n-quads',
      runIri,
      "graphIris": [...graphIris],
      nquads,
      "hash": GraphStateTransferCodec.transferHash(nquads, ''),
      ...metadata,
    };
  }

  static async inlineStream(
    runIri: string,
    graphIris: readonly string[],
    quads: AsyncIterable<QuadType>,
    identity: GraphStateTransferIdentityType,
  ): Promise<Extract<GraphStateTransferType, { readonly mode: 'inline-nquads' }>> {
    const chunks: string[] = [];
    let quadCount = 0;
    let byteSize = 0;
    const encoder = new TextEncoder();
    for await (const chunk of GraphStateTransferCodec.encodeStream(quads, () => { quadCount += 1; })) {
      chunks.push(chunk);
      byteSize += encoder.encode(chunk).byteLength;
    }
    const nquads = chunks.join('');
    const metadata: GraphStateTransferMetadataType = {
      "dagIri": identity.dagIri,
      "placementPath": [...identity.placementPath],
      "placementIri": identity.placementIri,
      "stateGraphIri": identity.stateGraphIri ?? graphIris[0] ?? `${runIri}#state`,
      "createdAt": new Date().toISOString(),
      "byteSize": byteSize,
      "quadCount": quadCount,
      "jsonLd": identity.jsonLd,
    };
    return {
      "mode": 'inline-nquads',
      "format": 'application/n-quads',
      runIri,
      "graphIris": [...graphIris],
      nquads,
      "hash": GraphStateTransferCodec.transferHash(nquads, ''),
      ...metadata,
    };
  }

  static apply(dataset: GraphDatasetInterface, transfer: GraphStateTransferType): void {
    if (transfer.mode !== 'inline-nquads' && transfer.mode !== 'inline-delta-nquads') throw new Error(`Transfer mode '${transfer.mode}' requires an external graph transfer store`);
    const additions = transfer.mode === 'inline-nquads' ? transfer.nquads : transfer.additions;
    if (GraphStateTransferCodec.transferHash(additions, transfer.mode === 'inline-delta-nquads' ? transfer.deletions : '') !== transfer.hash) throw new Error('Graph transfer integrity hash mismatch');
    if (transfer.mode === 'inline-delta-nquads') {
      if (transfer.baseRevision !== undefined && GraphStateTransferCodec.revision(dataset.exportGraph(DagGraphTerms.namedNode(transfer.stateGraphIri))) !== transfer.baseRevision) throw new Error('Graph delta base revision mismatch');
      dataset.transact((transaction) => {
        for (const quad of GraphStateTransferCodec.decode(transfer.deletions)) transaction.delete(quad);
        transaction.importGraph(GraphStateTransferCodec.decode(additions));
      });
      return;
    }
    dataset.importGraph(GraphStateTransferCodec.decode(additions));
  }

  static async reference(
    store: GraphStateTransferStoreInterface,
    runIri: string,
    graphIris: readonly string[],
    quads: Iterable<QuadType>,
    identity: GraphStateTransferIdentityType,
  ): Promise<Extract<GraphStateTransferType, { readonly mode: 'graph-ref' }>> {
    return GraphStateTransferCodec.referenceStream(store, runIri, graphIris, GraphStateTransferCodec.asyncQuads(quads), identity);
  }

  static async referenceStream(
    store: GraphStateTransferStoreInterface,
    runIri: string,
    graphIris: readonly string[],
    quads: AsyncIterable<QuadType>,
    identity: GraphStateTransferIdentityType,
  ): Promise<Extract<GraphStateTransferType, { readonly mode: 'graph-ref' }>> {
    const digest = createHash('sha256');
    let byteSize = 0;
    let quadCount = 0;
    const referenceId = `snapshot:${runIri}:${globalThis.crypto.randomUUID()}`;
    const reference: GraphStateSnapshotReferenceType = {
      "reference": referenceId,
      "format": 'application/n-quads',
      "graphIris": [...graphIris],
      "hash": 'pending',
      "dagIri": identity.dagIri,
      "placementPath": [...identity.placementPath],
      "placementIri": identity.placementIri,
      "stateGraphIri": identity.stateGraphIri ?? graphIris[0] ?? `${runIri}#state`,
      "createdAt": new Date().toISOString(),
      "byteSize": 0,
      "quadCount": 0,
      "jsonLd": identity.jsonLd,
    };
    const stored = await store.putSnapshot(GraphStateTransferCodec.hashingStream(quads, digest, (bytes) => { byteSize += bytes; quadCount += 1; }), reference);
    const hash = GraphStateTransferCodec.digestOf(digest);
    return {
      "mode": 'graph-ref',
      runIri,
      "graphSnapshotRef": stored.reference,
      "format": stored.format,
      "graphIris": [...stored.graphIris],
      "hash": hash,
      ...GraphStateTransferCodec.metadataOf({ ...stored, hash, byteSize, quadCount }, identity.jsonLd),
    };
  }

  static async shared(
    store: GraphStateTransferStoreInterface,
    runIri: string,
    graphIris: readonly string[],
    ttlMs: number,
    identity: GraphStateTransferIdentityType,
  ): Promise<Extract<GraphStateTransferType, { readonly mode: 'shared-endpoint' }>> {
    const lease = await store.acquireLease(graphIris, ttlMs);
    return {
      "mode": 'shared-endpoint',
      runIri,
      "endpoint": store.endpoint,
      "graphIris": [...graphIris],
      "lease": lease.token,
      "dagIri": identity.dagIri,
      "placementPath": [...identity.placementPath],
      "placementIri": identity.placementIri,
      "stateGraphIri": identity.stateGraphIri ?? graphIris[0] ?? `${runIri}#state`,
      "createdAt": new Date().toISOString(),
      "byteSize": 0,
      "quadCount": 0,
      "jsonLd": identity.jsonLd,
    };
  }

  static delta(
    runIri: string,
    baseSnapshotRef: string,
    additions: Iterable<QuadType>,
    deletions: Iterable<QuadType>,
    identity: GraphStateTransferIdentityType & { readonly baseRevision?: string; readonly revision?: string },
  ): Extract<GraphStateTransferType, { readonly mode: 'inline-delta-nquads' }> {
    const encodedAdditions = GraphStateTransferCodec.encode([...additions]);
    const encodedDeletions = GraphStateTransferCodec.encode([...deletions]);
    return {
      "mode": 'inline-delta-nquads',
      runIri,
      baseSnapshotRef,
      ...(identity.baseRevision === undefined ? {} : { "baseRevision": identity.baseRevision }),
      ...(identity.revision === undefined ? {} : { "revision": identity.revision }),
      "graphIris": [identity.stateGraphIri ?? `${runIri}#state`],
      "additions": encodedAdditions,
      "deletions": encodedDeletions,
      "hash": GraphStateTransferCodec.transferHash(encodedAdditions, encodedDeletions),
      "dagIri": identity.dagIri,
      "placementPath": [...identity.placementPath],
      "placementIri": identity.placementIri,
      "stateGraphIri": identity.stateGraphIri ?? `${runIri}#state`,
      "createdAt": identity.createdAt ?? new Date().toISOString(),
      "byteSize": identity.byteSize ?? new TextEncoder().encode(encodedAdditions + encodedDeletions).byteLength,
      "quadCount": identity.quadCount ?? GraphStateTransferCodec.decode(encodedAdditions).length,
      "jsonLd": identity.jsonLd,
    };
  }

  static deltaReference(
    runIri: string,
    baseSnapshotRef: string,
    additions: Iterable<QuadType>,
    deletions: Iterable<QuadType>,
    identity: GraphStateTransferIdentityType & { readonly baseRevision?: string; readonly revision?: string },
  ): Extract<GraphStateTransferType, { readonly mode: 'delta-ref' }> {
    const inline = GraphStateTransferCodec.delta(runIri, baseSnapshotRef, additions, deletions, identity);
    return { ...inline, "mode": 'delta-ref' };
  }

  static async applyExternal(dataset: GraphDatasetInterface, transfer: GraphStateTransferType, store: GraphStateTransferStoreInterface): Promise<void> {
    if (transfer.mode === 'inline-nquads' || transfer.mode === 'inline-delta-nquads') {
      GraphStateTransferCodec.apply(dataset, transfer);
      return;
    }
    if (transfer.mode === 'graph-ref') {
      await GraphStateTransferCodec.importVerified(dataset, store.readSnapshot(transfer.graphSnapshotRef), transfer.hash);
      return;
    }
    if (transfer.mode === 'shared-endpoint') {
      const lease: GraphStateTransferLeaseType = { "endpoint": transfer.endpoint, "token": transfer.lease, "graphIris": [...transfer.graphIris], "expiresAt": Number.POSITIVE_INFINITY };
      await GraphStateTransferCodec.importAsync(dataset, store.readShared(lease, transfer.graphIris));
      return;
    }
    if (GraphStateTransferCodec.transferHash(transfer.additions, transfer.deletions) !== transfer.hash) throw new Error('Graph transfer integrity hash mismatch');
    await GraphStateTransferCodec.importAsync(dataset, store.readSnapshot(transfer.baseSnapshotRef));
    if (transfer.baseRevision !== undefined && GraphStateTransferCodec.revision(dataset.exportGraph(DagGraphTerms.namedNode(transfer.stateGraphIri))) !== transfer.baseRevision) throw new Error('Graph delta base revision mismatch');
    dataset.transact((transaction) => {
      for (const quad of GraphStateTransferCodec.decode(transfer.deletions)) transaction.delete(quad);
      transaction.importGraph(GraphStateTransferCodec.decode(transfer.additions));
    });
  }

  static revision(quads: Iterable<QuadType>): string {
    return GraphDatasetRevision.ofQuads(quads);
  }

  static async discard(store: GraphStateTransferStoreInterface, reference: string): Promise<void> {
    await store.deleteSnapshot(reference);
  }

  static async restore(snapshot: GraphStateSnapshotInterface, transfer: GraphStateTransferType): Promise<void> {
    if (transfer.jsonLd === undefined) throw new Error(`Graph transfer '${transfer.mode}' is missing its JSON-LD node intermediate representation`);
    if (transfer.stateGraphIri !== `${transfer.runIri}#state` || !transfer.graphIris.includes(transfer.stateGraphIri)) {
      throw new Error('Graph transfer identity does not match the run state graph');
    }
    const quads = GraphStateJsonLdCodec.rebase(GraphStateJsonLdCodec.decode(transfer.jsonLd), transfer.runIri);
    await snapshot.restoreGraph(transfer.runIri, GraphStateJsonLdCodec.asyncQuads(quads));
  }

  static async *asyncQuads(quads: Iterable<QuadType>): AsyncIterable<QuadType> {
    yield* quads;
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

  private static async importAsync(dataset: GraphDatasetInterface, quads: AsyncIterable<QuadType>): Promise<void> {
    await dataset.transactAsync((transaction) => transaction.importGraphAsync(quads));
  }

  private static async importVerified(dataset: GraphDatasetInterface, quads: AsyncIterable<QuadType>, expectedHash: string): Promise<void> {
    const staging = dataset.fork();
    const digest = createHash('sha256');
    await staging.transactAsync((transaction) => transaction.importGraphAsync(GraphStateTransferCodec.hashingStream(quads, digest, () => undefined)));
    if (GraphStateTransferCodec.digestOf(digest) !== expectedHash) throw new Error('Graph transfer integrity hash mismatch');
    await dataset.transactAsync((transaction) => transaction.importGraphAsync(GraphStateTransferCodec.asyncQuads(staging.triples())));
  }

  private static async *hashingStream(
    quads: AsyncIterable<QuadType>,
    digest: ReturnType<typeof createHash>,
    onQuad: (byteSize: number) => void,
  ): AsyncIterable<QuadType> {
    const encoder = new TextEncoder();
    let byteSize = 0;
    const outputStream = {
      write(chunk: string, _encoding: string, done?: () => void): void {
        digest.update(chunk);
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

  private static digestOf(digest: ReturnType<typeof createHash>): string {
    digest.update('\u0000');
    return `sha256-${digest.digest('hex')}`;
  }

  private static metadataOf(reference: GraphStateSnapshotReferenceType, jsonLd: GraphStateTransferMetadataType['jsonLd']): GraphStateTransferMetadataType {
    return {
      "dagIri": reference.dagIri,
      "placementPath": [...reference.placementPath],
      "placementIri": reference.placementIri,
      "stateGraphIri": reference.stateGraphIri,
      "createdAt": reference.createdAt,
      "byteSize": reference.byteSize,
      "quadCount": reference.quadCount,
      jsonLd,
    };
  }

  private static hash(value: string): string {
    return `sha256-${createHash('sha256').update(value).digest('hex')}`;
  }

  private static transferHash(additions: string, deletions: string): string {
    return GraphStateTransferCodec.hash(`${additions}\u0000${deletions}`);
  }
}
