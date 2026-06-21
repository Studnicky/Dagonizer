/**
 * RdfProvObserver: wires Dagonizer's lifecycle hooks into PROV-O quads.
 *
 * One `prov:Activity` per node execution lands in
 * `urn:dagonizer:prov:<runId>` with `prov:startedAtTime`,
 * `prov:endedAtTime`, `prov:wasAssociatedWith` (the dispatcher /
 * provider / tool that performed it), `prov:wasInformedBy` (the
 * previous node activity), and `prov:used` / `prov:generated` for the
 * state values consumed and produced.
 *
 * The observer is engine-agnostic: it doesn't know about ArchivistState
 * fields, only about the lifecycle events the dispatcher fires.
 *
 * Wire it into an `ObservedDagonizer` via the `observer:` option;
 * `onFlowStart`/`onNodeStart`/`onNodeEnd`/`onError`/`onFlowEnd` all
 * call `record*` here, which immediately writes quads into the store.
 */

import type { NamedNode } from 'n3';

import { MemoryStore } from '../memory/MemoryStore.ts';

import { DAG_ACT, PROV, ProvIris, RDF_TYPE } from './PROV.ts';

export interface ProvObserverInputs {
  readonly store: MemoryStore;
  readonly runId: string;
  /** Agent IRI for the dispatcher itself. */
  readonly dispatcherAgentId: string;
}

export class RdfProvObserver {
  readonly #store: MemoryStore;
  readonly #runId: string;
  readonly #graph: NamedNode;
  readonly #dispatcher: NamedNode;
  readonly #run: NamedNode;
  #lastActivity: NamedNode | null = null;
  readonly #activeByNode = new Map<string, NamedNode>();

  constructor(inputs: ProvObserverInputs) {
    this.#store = inputs.store;
    this.#runId = inputs.runId;
    this.#graph = MemoryStore.provGraphIri(this.#runId);
    this.#dispatcher = ProvIris.agent(inputs.dispatcherAgentId);
    this.#run = ProvIris.activity(this.#runId, 'run', 0);
  }

  recordFlowStart(dagName: string): void {
    this.#typed(this.#dispatcher, PROV.SoftwareAgent);
    this.#store.assert(this.#dispatcher, MemoryStore.dagIri('agentLabel'),
      MemoryStore.lit.str(this.#runId), this.#graph);
    this.#typed(this.#run, PROV.Activity);
    this.#typed(this.#run, DAG_ACT.Run);
    this.#store.assert(this.#run, MemoryStore.dagIri('dagName'),
      MemoryStore.lit.str(dagName), this.#graph);
    this.#store.assert(this.#run, PROV.startedAtTime,
      MemoryStore.lit.dateTime(new Date()), this.#graph);
    this.#store.assert(this.#run, PROV.wasAssociatedWith,
      this.#dispatcher, this.#graph);
  }

  recordNodeStart(nodeName: string): void {
    const now = Date.now();
    const activity = ProvIris.activity(this.#runId, nodeName, now);
    this.#typed(activity, PROV.Activity);
    this.#typed(activity, DAG_ACT.NodeExecution);
    this.#store.assert(activity, MemoryStore.dagIri('nodeName'),
      MemoryStore.lit.str(nodeName), this.#graph);
    this.#store.assert(activity, PROV.startedAtTime,
      MemoryStore.lit.dateTime(new Date(now)), this.#graph);
    this.#store.assert(activity, PROV.wasAssociatedWith,
      this.#dispatcher, this.#graph);
    // wasInformedBy: chain to the previous activity (if any).
    if (this.#lastActivity !== null) {
      this.#store.assert(activity, PROV.wasInformedBy, this.#lastActivity, this.#graph);
    } else {
      this.#store.assert(activity, PROV.wasInformedBy, this.#run, this.#graph);
    }
    this.#lastActivity = activity;
    this.#activeByNode.set(nodeName, activity);
  }

  recordNodeEnd(nodeName: string, output: string | undefined): void {
    const activity = this.#activeByNode.get(nodeName);
    if (activity === undefined) return;
    this.#store.assert(activity, PROV.endedAtTime,
      MemoryStore.lit.dateTime(new Date()), this.#graph);
    if (output !== undefined) {
      this.#store.assert(activity, MemoryStore.dagIri('output'),
        MemoryStore.lit.str(output), this.#graph);
    }
    this.#activeByNode.delete(nodeName);
  }

  recordError(nodeName: string, error: Error): void {
    const activity = this.#activeByNode.get(nodeName);
    if (activity === undefined) return;
    this.#store.assert(activity, MemoryStore.dagIri('error'),
      MemoryStore.lit.str(error.message), this.#graph);
    this.#store.assert(activity, PROV.endedAtTime,
      MemoryStore.lit.dateTime(new Date()), this.#graph);
    this.#activeByNode.delete(nodeName);
  }

  recordFlowEnd(lifecycle: string): void {
    this.#store.assert(this.#run, PROV.endedAtTime,
      MemoryStore.lit.dateTime(new Date()), this.#graph);
    this.#store.assert(this.#run, MemoryStore.dagIri('lifecycle'),
      MemoryStore.lit.str(lifecycle), this.#graph);
  }

  /**
   * Sub-activity for one tool call. The parent node activity must have
   * been started before this is invoked.
   *
   *   const child = obs.recordToolCall('open-library-scout', 'web_search_books', { query: 'Piranesi' });
   *   try { await tool.execute(...); }
   *   finally { obs.recordToolEnd(child, candidates.length); }
   */
  recordToolCall(parentNode: string, toolName: string, args: Record<string, unknown>): NamedNode {
    const parent = this.#activeByNode.get(parentNode) ?? this.#run;
    const now = Date.now();
    const activity = ProvIris.activity(this.#runId, `tool-${toolName}`, now);
    this.#typed(activity, PROV.Activity);
    this.#typed(activity, DAG_ACT.ToolCall);
    const agent = ProvIris.agent(`tool:${toolName}`);
    this.#typed(agent, PROV.SoftwareAgent);
    this.#store.assert(activity, MemoryStore.dagIri('toolName'),
      MemoryStore.lit.str(toolName), this.#graph);
    this.#store.assert(activity, PROV.startedAtTime,
      MemoryStore.lit.dateTime(new Date(now)), this.#graph);
    this.#store.assert(activity, PROV.wasInformedBy, parent, this.#graph);
    this.#store.assert(activity, PROV.wasAssociatedWith, agent, this.#graph);
    this.#store.assert(activity, MemoryStore.dagIri('arguments'),
      MemoryStore.lit.str(JSON.stringify(args)), this.#graph);
    return activity;
  }

  recordToolEnd(activity: NamedNode, resultSummary: string): void {
    this.#store.assert(activity, PROV.endedAtTime,
      MemoryStore.lit.dateTime(new Date()), this.#graph);
    this.#store.assert(activity, MemoryStore.dagIri('result'),
      MemoryStore.lit.str(resultSummary), this.#graph);
  }

  /** Sub-activity for one LLM round-trip. */
  recordLlmCall(parentNode: string, providerId: string, callVariant: string): NamedNode {
    const parent = this.#activeByNode.get(parentNode) ?? this.#run;
    const now = Date.now();
    const activity = ProvIris.activity(this.#runId, `llm-${callVariant}`, now);
    this.#typed(activity, PROV.Activity);
    this.#typed(activity, DAG_ACT.LlmCall);
    const agent = ProvIris.agent(`llm:${providerId}`);
    this.#typed(agent, PROV.SoftwareAgent);
    this.#store.assert(activity, MemoryStore.dagIri('llmVariant'),
      MemoryStore.lit.str(callVariant), this.#graph);
    this.#store.assert(activity, PROV.startedAtTime,
      MemoryStore.lit.dateTime(new Date(now)), this.#graph);
    this.#store.assert(activity, PROV.wasInformedBy, parent, this.#graph);
    this.#store.assert(activity, PROV.wasAssociatedWith, agent, this.#graph);
    return activity;
  }

  recordLlmEnd(activity: NamedNode, tokensIn: number, tokensOut: number): void {
    this.#store.assert(activity, PROV.endedAtTime,
      MemoryStore.lit.dateTime(new Date()), this.#graph);
    this.#store.assert(activity, MemoryStore.dagIri('tokensIn'),
      MemoryStore.lit.int(tokensIn), this.#graph);
    this.#store.assert(activity, MemoryStore.dagIri('tokensOut'),
      MemoryStore.lit.int(tokensOut), this.#graph);
  }

  /** Drop everything written for this run; used on reset. */
  reset(): void {
    this.#store.clearGraph(this.#graph);
    this.#lastActivity = null;
    this.#activeByNode.clear();
  }

  #typed(subject: NamedNode, type: NamedNode): void {
    this.#store.assert(subject, RDF_TYPE, type, this.#graph);
  }
}
