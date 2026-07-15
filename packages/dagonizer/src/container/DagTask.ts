/**
 * DagTask: engine-side task object implementing `DagTaskInterface`.
 *
 * Carries the live seeded child clone (`state: NodeStateInterface`) so the
 * in-process path can execute against it directly. Isolating containers call
 * `toRequest()` to snapshot the clone into a wire-safe `ExecutionRequest`.
 *
 * Constructor args are required positional in declaration order (V8 shape
 * stability). All fields are readonly and initialized in the constructor.
 */

import type { DagTaskInterface } from '../contracts/DagTaskInterface.js';
import type { ExecutionRequestType } from '../entities/executor/ExecutionRequest.js';
import type { NodeContextType } from '../entities/node/NodeContext.js';
import type { Timeout } from '../entities/Timeout.js';
import { DagGraphTerms } from '../graph/DagGraphTerms.js';
import { GraphStateJsonLdCodec } from '../graph/GraphStateJsonLdCodec.js';
import { GraphStateTerms } from '../graph/GraphStateTerms.js';
import { GraphStateTransferCodec } from '../graph/GraphStateTransferCodec.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

export type { DagTaskInterface };

export class DagTask
  implements DagTaskInterface
{
  readonly dagName: string;
  readonly placementPath: string[];
  readonly correlationId: string;
  readonly timeout: Timeout;
  readonly state: NodeStateInterface;
  readonly context: NodeContextType;

  constructor(
    dagName: string,
    placementPath: readonly string[],
    correlationId: string,
    timeout: Timeout,
    state: NodeStateInterface,
    context: NodeContextType,
  ) {
    this.dagName = dagName;
    this.placementPath = [...placementPath];
    this.correlationId = correlationId;
    this.timeout = timeout;
    this.state = state;
    this.context = context;
  }

  /**
   * Materialise the wire form from the live graph clone. Called by
   * isolating containers before sending the task across the transport boundary.
   * Produces a single-item request (N=1); multi-item batch requests are
   * built by `DagContainerBase.runDagBatch` directly.
   */
  toRequest(): ExecutionRequestType {
    return {
      'dagName':       this.dagName,
      'placementPath': [...this.placementPath],
      'items':         [{ 'id': this.correlationId, 'graphState': this.stateGraph() }],
      'timeoutMs':     this.timeout.toWire(),
      'correlationId': this.correlationId,
    };
  }

  private stateGraph() {
    const graphIri = GraphStateTerms.runGraphIri(this.state.runIri);
    const placementIri = this.placementPath.at(-1);
    if (placementIri === undefined) throw new Error('Graph transfer requires an absolute placement identity');
    const quads = [...this.state.graphDataset.exportGraph(DagGraphTerms.namedNode(graphIri))];
    return GraphStateTransferCodec.inline(
      this.state.runIri,
      [graphIri],
      quads,
      {
        'dagIri': this.dagName,
        'placementPath': this.placementPath,
        'placementIri': placementIri,
        'stateGraphIri': graphIri,
        'jsonLd': GraphStateJsonLdCodec.encode(quads),
      },
    );
  }
}
