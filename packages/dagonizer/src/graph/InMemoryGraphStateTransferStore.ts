import type { GraphStateSnapshotReferenceType } from '../contracts/GraphStateSnapshotReference.js';
import type { GraphStateTransferLeaseType } from '../contracts/GraphStateTransferLease.js';
import type { GraphStateTransferStoreInterface } from '../contracts/GraphStateTransferStoreInterface.js';
import type { QuadType } from '../contracts/TripleStoreInterface.js';

/** In-memory snapshot and lease adapter for tests and local graph execution. */
export class InMemoryGraphStateTransferStore implements GraphStateTransferStoreInterface {
  readonly #snapshots = new Map<string, readonly QuadType[]>();
  readonly #leases = new Map<string, GraphStateTransferLeaseType>();
  readonly #endpoint: string;
  readonly #source: (graphIris: readonly string[]) => AsyncIterable<QuadType>;

  constructor(endpoint: string, source: (graphIris: readonly string[]) => AsyncIterable<QuadType> = () => InMemoryGraphStateTransferStore.empty()) {
    this.#endpoint = endpoint;
    this.#source = source;
  }

  get endpoint(): string {
    return this.#endpoint;
  }

  async putSnapshot(quads: AsyncIterable<QuadType>, metadata: GraphStateSnapshotReferenceType): Promise<GraphStateSnapshotReferenceType> {
    const materialized: QuadType[] = [];
    for await (const quad of quads) materialized.push(quad);
    this.#snapshots.set(metadata.reference, materialized);
    return metadata;
  }

  async *readSnapshot(reference: string): AsyncIterable<QuadType> {
    const snapshot = this.#snapshots.get(reference);
    if (snapshot === undefined) throw new Error(`Unknown graph snapshot reference '${reference}'`);
    yield* snapshot;
  }

  async deleteSnapshot(reference: string): Promise<void> {
    this.#snapshots.delete(reference);
  }

  async acquireLease(graphIris: readonly string[], ttlMs: number): Promise<GraphStateTransferLeaseType> {
    const now = Date.now();
    for (const [token, lease] of this.#leases) {
      if (lease.expiresAt <= now) this.#leases.delete(token);
      else if (lease.graphIris.some((graphIri) => graphIris.includes(graphIri))) throw new Error('Graph transfer lease is already held');
    }
    const lease = {
      "endpoint": this.#endpoint,
      "token": `lease:${globalThis.crypto.randomUUID()}`,
      "graphIris": [...graphIris],
      "expiresAt": now + ttlMs,
    } satisfies GraphStateTransferLeaseType;
    this.#leases.set(lease.token, lease);
    return lease;
  }

  async releaseLease(lease: GraphStateTransferLeaseType): Promise<void> {
    this.#leases.delete(lease.token);
  }

  async *readShared(lease: GraphStateTransferLeaseType, graphIris: readonly string[]): AsyncIterable<QuadType> {
    this.#assertLease(lease, graphIris);
    const written = this.#snapshots.get(`shared:${lease.token}`);
    if (written !== undefined) {
      yield* written;
      return;
    }
    yield* this.#source(graphIris);
  }

  async writeShared(lease: GraphStateTransferLeaseType, quads: AsyncIterable<QuadType>): Promise<void> {
    this.#assertLease(lease, lease.graphIris);
    const materialized: QuadType[] = [];
    for await (const quad of quads) materialized.push(quad);
    this.#snapshots.set(`shared:${lease.token}`, materialized);
  }

  #assertLease(lease: GraphStateTransferLeaseType, graphIris: readonly string[]): void {
    const current = this.#leases.get(lease.token);
    if (current === undefined || current.expiresAt <= Date.now()) throw new Error('Graph transfer lease is expired or unknown');
    if (current.endpoint !== this.#endpoint || graphIris.some((graphIri) => !current.graphIris.includes(graphIri))) throw new Error('Graph transfer lease scope mismatch');
  }

  private static async *empty(): AsyncIterable<QuadType> { /* empty source */ }
}
