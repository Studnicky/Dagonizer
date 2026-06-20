/**
 * PROV: W3C PROV-O ontology IRI constants.
 *
 * https://www.w3.org/TR/prov-o/
 *
 * The Archivist writes every node execution as a `prov:Activity` into
 * `urn:dagonizer:prov:<runId>`. Standard relations:
 *
 *   prov:Activity:         a node execution / tool call / LLM round-trip
 *   prov:Entity:           an artefact (state value, candidate, draft)
 *   prov:Agent:            who did it (the dispatcher, the LLM provider, the tool)
 *   prov:wasGeneratedBy:   entity ← activity (output)
 *   prov:used:             activity → entity (input)
 *   prov:wasInformedBy:    activity → activity (causal chain)
 *   prov:wasAttributedTo:  entity → agent
 *   prov:wasAssociatedWith: activity → agent (who performed it)
 *   prov:startedAtTime:    activity → xsd:dateTime
 *   prov:endedAtTime:      activity → xsd:dateTime
 *
 * Custom sub-types under the dag: vocabulary classify the activity:
 *
 *   dag:NodeExecution:     one DAG node firing
 *   dag:ToolCall:          one tool invocation (web_search_books etc.)
 *   dag:LlmCall:           one LLM round-trip
 *   dag:Run:               the whole top-level execution
 */

import type { Term } from 'n3';

import { MemoryStore } from '../memory/MemoryStore.ts';

const PROV_NS = 'http://www.w3.org/ns/prov#';

export const PROV = {
  // Classes
  "Activity":           MemoryStore.iri(`${PROV_NS}Activity`),
  "Entity":             MemoryStore.iri(`${PROV_NS}Entity`),
  "Agent":              MemoryStore.iri(`${PROV_NS}Agent`),
  "SoftwareAgent":      MemoryStore.iri(`${PROV_NS}SoftwareAgent`),
  // Properties: activity ↔ time
  "startedAtTime":      MemoryStore.iri(`${PROV_NS}startedAtTime`),
  "endedAtTime":        MemoryStore.iri(`${PROV_NS}endedAtTime`),
  // Properties: activity ↔ entity
  "used":               MemoryStore.iri(`${PROV_NS}used`),
  "generated":          MemoryStore.iri(`${PROV_NS}generated`),
  "wasGeneratedBy":     MemoryStore.iri(`${PROV_NS}wasGeneratedBy`),
  // Properties: activity ↔ activity
  "wasInformedBy":      MemoryStore.iri(`${PROV_NS}wasInformedBy`),
  // Properties: entity/activity ↔ agent
  "wasAttributedTo":    MemoryStore.iri(`${PROV_NS}wasAttributedTo`),
  "wasAssociatedWith":  MemoryStore.iri(`${PROV_NS}wasAssociatedWith`),
  // Properties: narrative
  "value":              MemoryStore.iri(`${PROV_NS}value`),
} as const;

const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
export const RDF_TYPE = MemoryStore.iri(`${RDF_NS}type`);

/** Custom dag: subclasses of prov:Activity. */
export const DAG_ACT = {
  "Run":           MemoryStore.dagIri('Run'),
  "NodeExecution": MemoryStore.dagIri('NodeExecution'),
  "ToolCall":      MemoryStore.dagIri('ToolCall'),
  "LlmCall":       MemoryStore.dagIri('LlmCall'),
} as const;

/** Per-run IRI factories. */
export const ProvIris = {
  activity(runId: string, name: string, ts: number): Term {
    return MemoryStore.iri(`urn:dagonizer:activity:${runId}:${encodeURIComponent(name)}:${String(ts)}`);
  },
  agent(id: string): Term {
    return MemoryStore.iri(`urn:dagonizer:agent:${encodeURIComponent(id)}`);
  },
  entity(entityVariant: string, key: string): Term {
    return MemoryStore.iri(`urn:dagonizer:entity:${entityVariant}:${encodeURIComponent(key)}`);
  },
};
