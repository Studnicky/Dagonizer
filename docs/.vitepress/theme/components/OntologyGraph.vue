<script setup lang="ts">
/**
 * OntologyGraph — cytoscape-dagre TBox visualisation.
 *
 * Reads the `urn:dagonizer:ontology` named graph from the MemoryStore and
 * renders:
 *   • Classes            — round-rectangle nodes (teal border)
 *   • Object properties  — cut-rectangle nodes (gold border)
 *   • Datatype props     — round-tag nodes (violet dashed border)
 *   • subClassOf edges   — solid teal
 *   • domain edges       — dashed gold
 *   • range edges        — dotted violet
 *
 * Layout: dagre TB so class hierarchies flow top-to-bottom.
 * Reactive: re-renders when `tick` changes (loadOntology bumps memoryTick).
 */

import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Core, ElementDefinition } from 'cytoscape';

import type { MemoryStore } from '../../../../examples/the-archivist/memory/MemoryStore.ts';
import { GRAPH_ONTOLOGY } from '../../../../examples/the-archivist/memory/MemoryStore.ts';

import DiagramFrame from './DiagramFrame.vue';

const OWL_CLASS = 'http://www.w3.org/2002/07/owl#Class';
const OWL_OP    = 'http://www.w3.org/2002/07/owl#ObjectProperty';
const OWL_DP    = 'http://www.w3.org/2002/07/owl#DatatypeProperty';
const RDF_TYPE  = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const RDFS_SUB  = 'http://www.w3.org/2000/01/rdf-schema#subClassOf';
const RDFS_DOM  = 'http://www.w3.org/2000/01/rdf-schema#domain';
const RDFS_RNG  = 'http://www.w3.org/2000/01/rdf-schema#range';

const props = defineProps<{
  store: MemoryStore;
  tick: number;
}>();

const containerRef = ref<HTMLDivElement | null>(null);
const cy = ref<Core | null>(null);
const loading = ref(true);
const loadError = ref<string | null>(null);
let resizeObserver: ResizeObserver | null = null;

function localName(iri: string): string {
  const hash = iri.lastIndexOf('#');
  if (hash >= 0) return iri.slice(hash + 1);
  const slash = iri.lastIndexOf('/');
  if (slash >= 0) return iri.slice(slash + 1);
  return iri;
}

function buildElements(): ElementDefinition[] {
  const nodes = new Map<string, { kind: string }>();
  const edges: Array<{ id: string; source: string; target: string; edgeKind: string }> = [];
  const edgeSeen = new Set<string>();

  for (const q of props.store.triplesIn(GRAPH_ONTOLOGY)) {
    if (q.predicate.value !== RDF_TYPE) continue;
    const s = q.subject.value;
    const o = q.object.value;
    if (o === OWL_CLASS)     nodes.set(s, { 'kind': 'class' });
    else if (o === OWL_OP)   nodes.set(s, { 'kind': 'objectprop' });
    else if (o === OWL_DP)   nodes.set(s, { 'kind': 'datatypeprop' });
  }

  for (const q of props.store.triplesIn(GRAPH_ONTOLOGY)) {
    const pred = q.predicate.value;
    const subj = q.subject.value;
    const obj  = q.object.value;

    let edgeKind = '';
    if (pred === RDFS_SUB) edgeKind = 'subClassOf';
    else if (pred === RDFS_DOM) edgeKind = 'domain';
    else if (pred === RDFS_RNG) edgeKind = 'range';

    if (edgeKind === '') continue;
    if (!nodes.has(subj) || !nodes.has(obj)) continue;

    const edgeId = `${subj}__${edgeKind}__${obj}`;
    if (edgeSeen.has(edgeId)) continue;
    edgeSeen.add(edgeId);
    edges.push({ 'id': edgeId, 'source': subj, 'target': obj, 'edgeKind': edgeKind });
  }

  const elements: ElementDefinition[] = [];

  for (const [id, meta] of nodes) {
    elements.push({
      'data': { 'id': id, 'label': localName(id), 'kind': meta.kind },
    });
  }

  for (const e of edges) {
    elements.push({
      'data': {
        'id': e.id,
        'source': e.source,
        'target': e.target,
        'edgeKind': e.edgeKind,
        'label': e.edgeKind,
      },
    });
  }

  return elements;
}

onMounted(async () => {
  let cytoscape: typeof import('cytoscape').default;
  try {
    const [coreMod, dagreMod] = await Promise.all([
      import('cytoscape'),
      import('cytoscape-dagre'),
    ]);
    cytoscape = coreMod.default;
    cytoscape.use(dagreMod.default);
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
    loading.value = false;
    return;
  }
  loading.value = false;

  const container = containerRef.value;
  if (container === null) return;

  await nextTick();

  cy.value = cytoscape({
    'container': container,
    'elements':  buildElements(),
    'style':     stylesheet(),
    'layout':    ontologyLayout(),
    'userPanningEnabled':  true,
    'userZoomingEnabled':  true,
    'boxSelectionEnabled': true,
    'wheelSensitivity':    0.25,
  });

  cy.value.one('layoutstop', () => {
    cy.value?.fit(undefined, 40);
    requestAnimationFrame(() => {
      const fitZoom = cy.value?.zoom() ?? 1;
      cy.value?.minZoom(fitZoom * 0.35);
      cy.value?.maxZoom(fitZoom * 6);
    });
  });

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      cy.value?.resize();
      cy.value?.fit(undefined, 40);
    });
    resizeObserver.observe(container);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  cy.value?.destroy();
  cy.value = null;
});

watch(() => props.tick, () => {
  if (cy.value === null) return;
  cy.value.elements().remove();
  cy.value.add(buildElements());
  const layout = cy.value.layout(ontologyLayout());
  layout.run();
  cy.value.one('layoutstop', () => cy.value?.fit(undefined, 40));
});

function onFrameResize(): void {
  cy.value?.resize();
  cy.value?.fit(undefined, 40);
}

function zoomIn(): void {
  const next = (cy.value?.zoom() ?? 1) * 1.25;
  cy.value?.zoom({
    'level': Math.min(next, cy.value.maxZoom()),
    'renderedPosition': { 'x': cy.value.width() / 2, 'y': cy.value.height() / 2 },
  });
}

function zoomOut(): void {
  const next = (cy.value?.zoom() ?? 1) / 1.25;
  cy.value?.zoom({
    'level': Math.max(next, cy.value.minZoom()),
    'renderedPosition': { 'x': cy.value.width() / 2, 'y': cy.value.height() / 2 },
  });
}

function fit(): void { cy.value?.fit(undefined, 40); }

function rerunLayout(): void {
  if (cy.value === null) return;
  const layout = cy.value.layout(ontologyLayout());
  layout.run();
  cy.value.one('layoutstop', () => cy.value?.fit(undefined, 40));
}

function ontologyLayout(): Record<string, unknown> {
  return {
    'name':    'dagre',
    'rankDir': 'TB',
    'align':   'UL',
    'rankSep': 80,
    'nodeSep': 55,
    'edgeSep': 20,
    'ranker':  'network-simplex',
    'fit':     true,
    'padding': 40,
    'animate': false,
    'nodeDimensionsIncludeLabels': true,
  };
}

function stylesheet(): unknown[] {
  return [
    { 'selector': 'node', 'style': {
      'background-color':     'var(--vp-c-bg-alt)',
      'border-color':         'var(--vp-c-divider)',
      'border-width':         1.5,
      'color':                'var(--vp-c-text-1)',
      'label':                'data(label)',
      'font-family':          'var(--vp-font-family-mono)',
      'font-size':            13,
      'font-weight':          700,
      'text-halign':          'center',
      'text-valign':          'center',
      'text-wrap':            'wrap',
      'text-max-width':       '160px',
      'text-outline-color':   'var(--vp-c-bg)',
      'text-outline-width':   1,
      'text-outline-opacity': 0.85,
      'padding':              '14px',
      'width':                'label',
      'height':               'label',
      'shape':                'round-rectangle',
    } },

    { 'selector': 'node[kind="class"]', 'style': {
      'border-color':     '#22e8ff',
      'border-width':     2.5,
      'border-style':     'solid',
      'background-color': 'rgba(34,232,255,0.06)',
    } },

    { 'selector': 'node[kind="objectprop"]', 'style': {
      'border-color':     '#d4a649',
      'border-width':     2,
      'border-style':     'solid',
      'background-color': 'rgba(212,166,73,0.06)',
      'shape':            'cut-rectangle',
    } },

    { 'selector': 'node[kind="datatypeprop"]', 'style': {
      'border-color':     '#9b51e0',
      'border-width':     2,
      'border-style':     'dashed',
      'background-color': 'rgba(155,81,224,0.06)',
      'shape':            'round-tag',
    } },

    { 'selector': 'node:selected', 'style': {
      'border-width':     4,
      'overlay-opacity':  0.12,
      'overlay-color':    '#22e8ff',
    } },

    { 'selector': 'edge', 'style': {
      'curve-style':              'bezier',
      'target-arrow-shape':       'triangle',
      'arrow-scale':              1.2,
      'label':                    'data(label)',
      'font-family':              'var(--vp-font-family-mono)',
      'font-size':                11,
      'font-weight':              600,
      'color':                    'var(--vp-c-text-2)',
      'text-background-color':    '#0c0a14',
      'text-background-opacity':  0.9,
      'text-background-padding':  '4px',
      'text-background-shape':    'round-rectangle',
      'text-margin-y':            -4,
      'width':                    1.6,
      'line-color':               'var(--vp-c-divider)',
      'target-arrow-color':       'var(--vp-c-divider)',
    } },

    { 'selector': 'edge[edgeKind="subClassOf"]', 'style': {
      'line-color':           '#22e8ff',
      'target-arrow-color':   '#22e8ff',
      'color':                '#22e8ff',
      'line-style':           'solid',
      'width':                2.2,
    } },

    { 'selector': 'edge[edgeKind="domain"]', 'style': {
      'line-color':           '#d4a649',
      'target-arrow-color':   '#d4a649',
      'color':                '#d4a649',
      'line-style':           'dashed',
    } },

    { 'selector': 'edge[edgeKind="range"]', 'style': {
      'line-color':           '#9b51e0',
      'target-arrow-color':   '#9b51e0',
      'color':                '#c89bff',
      'line-style':           'dotted',
    } },
  ];
}

function classCount(): number { return cy.value?.nodes('[kind="class"]').length ?? 0; }
function opCount(): number    { return cy.value?.nodes('[kind="objectprop"]').length ?? 0; }
function dpCount(): number    { return cy.value?.nodes('[kind="datatypeprop"]').length ?? 0; }
</script>

<template>
  <DiagramFrame
    title="Ontology"
    :aria-label="`TBox schema graph: ${String(store.count({ 'graph': GRAPH_ONTOLOGY }))} triples`"
    @resize="onFrameResize"
  >
    <template #meta>
      <span class="og-stat"><span class="og-chip og-chip-c">C</span>{{ classCount() }}</span>
      <span class="og-stat"><span class="og-chip og-chip-op">OP</span>{{ opCount() }}</span>
      <span class="og-stat"><span class="og-chip og-chip-dp">DP</span>{{ dpCount() }}</span>
    </template>
    <template #controls>
      <button class="frame-action" title="Zoom in"       @click="zoomIn">＋</button>
      <button class="frame-action" title="Zoom out"      @click="zoomOut">－</button>
      <button class="frame-action" title="Fit to view"   @click="fit">⤢</button>
      <button class="frame-action" title="Re-run layout" @click="rerunLayout">⟳</button>
    </template>

    <div v-if="loading"   class="og-overlay">Loading graph…</div>
    <div v-if="loadError" class="og-overlay og-error">Graph failed: {{ loadError }}</div>
    <div
      v-if="!loading && !loadError && store.count({ 'graph': GRAPH_ONTOLOGY }) === 0"
      class="og-overlay og-empty"
    >
      Ontology graph not yet loaded. Refresh the page.
    </div>

    <div
      v-show="!loading && !loadError"
      ref="containerRef"
      class="og-cy"
      aria-label="Ontology TBox schema graph"
    ></div>

    <aside v-if="!loading && !loadError" class="og-legend" aria-label="Edge type legend">
      <span class="og-leg-subclass">— subClassOf</span>
      <span class="og-leg-domain">- - domain</span>
      <span class="og-leg-range">··· range</span>
    </aside>
  </DiagramFrame>
</template>

<style scoped>
.og-cy {
  width: 100%;
  height: 100%;
  min-height: 480px;
  background: var(--vp-c-bg);
}

.og-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
  pointer-events: none;
}

.og-error { color: var(--dagonizer-brand3); }
.og-empty { color: var(--vp-c-text-3); font-style: italic; }

.og-stat {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-family: var(--vp-font-family-mono);
  font-size: 0.68rem;
}

.og-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.1rem 0.32rem;
  border-radius: 3px;
  font-size: 0.6rem;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.og-chip-c  { background: rgba(34,232,255,0.15);  color: #22e8ff; }
.og-chip-op { background: rgba(212,166,73,0.15);  color: #d4a649; }
.og-chip-dp { background: rgba(155,81,224,0.15);  color: #c89bff; }

.og-legend {
  position: absolute;
  bottom: 10px;
  right: 12px;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  background: rgba(0,0,0,0.55);
  backdrop-filter: blur(4px);
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  padding: 0.35rem 0.6rem;
  pointer-events: none;
  z-index: 4;
}

.og-legend span {
  font-family: var(--vp-font-family-mono);
  font-size: 0.65rem;
  font-weight: 600;
  white-space: nowrap;
}

.og-leg-subclass { color: #22e8ff; }
.og-leg-domain   { color: #d4a649; }
.og-leg-range    { color: #c89bff; }

.frame-action {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  color: var(--vp-c-text-1);
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  padding: 0;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}

.frame-action:hover {
  background: var(--vp-c-bg);
  border-color: var(--dagonizer-brand);
  color: var(--dagonizer-brand);
}
</style>
