<script setup lang="ts">
/**
 * MemoryGraph — cosmos.gl view of the n3.js triple store.
 *
 * Triples are a graph by construction: every (subject, predicate, object)
 * is an edge. Subjects + IRI objects become "iri" points (teal); literal
 * objects become "literal" points (violet, dashed feel via lower alpha).
 *
 *   • Points are positioned/colored/sized via packed `Float32Array`s
 *     handed to cosmos.gl. Every memory-tick we rebuild the buffers and
 *     `start(alpha)` the simulation so new points settle in.
 *   • Labels are drawn on a separate <canvas> overlay (cosmos.gl has no
 *     native text). On every simulation tick we map world → screen via
 *     `graph.spaceToScreenPosition(...)` and draw the local-name labels
 *     with a small dark pill background.
 *
 * Lazy-loaded: `@cosmos.gl/graph` ships a WebGL2 shader pipeline and
 * adds ~250KB gzipped — we dynamic-import on mount so the rest of the
 * docs bundle stays light.
 *
 * Mirrors the Pokemontology viewer's ExplorerCanvas pattern at a
 * fraction of the surface (single store, no streaming, no worker).
 */

import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { Quad } from 'n3';

import type { MemoryStore } from '../../../../examples/the-archivist/memory/MemoryStore.ts';
import DiagramFrame from './DiagramFrame.vue';
import GraphDpad from './graph/GraphDpad.vue';
import GraphLegend from './graph/GraphLegend.vue';
import type { LegendEntry, LegendTab } from './graph/GraphLegend.vue';

type GraphHandle = {
  setPointPositions(arr: Float32Array): void;
  setPointColors(arr: Float32Array): void;
  setPointSizes(arr: Float32Array): void;
  setLinks(arr: Float32Array): void;
  setConfig?(config: Record<string, unknown>): void;
  render(alpha?: number): void;
  start(alpha?: number): void;
  pause(): void;
  fitView(duration?: number, padding?: number): void;
  getZoomLevel(): number;
  setZoomLevel(level: number): void;
  spaceToScreenPosition(point: readonly [number, number]): readonly [number, number];
  getPointPositions(): readonly number[];
  destroy(): void;
};

/** Which named-graph layer a point belongs to. */
type GraphLayer = 'ontology' | 'memory' | 'state' | 'prov' | 'default';

const props = defineProps<{
  store: MemoryStore;
  tick: number;
}>();

const emit = defineEmits<{
  (event: 'clear'): void;
  (event: 'select', iri: string | null): void;
}>();

/** Per-layer visibility toggles — chip filter at top of canvas. */
const layerVisible = ref<Record<GraphLayer, boolean>>({
  'ontology': true,
  'memory':  true,
  'state':   true,
  'prov':    true,
  'default': true,
});

/** Cosmos.gl does not expose a first-class pan API — pan buttons are disabled. */
const PAN_ENABLED = false;

/** Layer entries for GraphLegend — reactive so active state reflects layerVisible. */
const memoryLegendTabs = computed<readonly LegendTab[]>(() => {
  const entries: LegendEntry[] = [
    { key: 'ontology', swatch: 'solid',  color: '#21ee99', label: 'ontology', active: layerVisible.value['ontology'] },
    { key: 'memory',   swatch: 'solid',  color: '#22e8ff', label: 'memory',   active: layerVisible.value['memory'] },
    { key: 'state',    swatch: 'solid',  color: '#d4a649', label: 'state',    active: layerVisible.value['state'] },
    { key: 'prov',     swatch: 'solid',  color: '#9b51e0', label: 'prov',     active: layerVisible.value['prov'] },
  ];
  return [{ key: 'layers', label: 'Layers', entries }];
});

function onLayerToggle(key: string): void {
  const layer = key as GraphLayer;
  if (layer in layerVisible.value) {
    layerVisible.value[layer] = !layerVisible.value[layer];
  }
}

defineOptions({ inheritAttrs: false });

const containerRef = ref<HTMLDivElement | null>(null);
const labelsRef = ref<HTMLCanvasElement | null>(null);
const loading = ref(true);
const loadError = ref<string | null>(null);
const zoomLevel = ref<number>(1);
/** Zoom level at last fitView — zoom-out floor so graph never shrinks to a dot. */
const fitZoomLevel = ref<number | null>(null);

const graph = shallowRef<GraphHandle | null>(null);
interface PointMeta {
  readonly label: string;
  readonly kind:  'iri' | 'literal';
  readonly layer: GraphLayer;
  readonly iri:   string;
}
let labelMeta: PointMeta[] = [];
let labelRaf: number | null = null;
let resizeObserver: ResizeObserver | null = null;

type CosmosCtor = new (div: HTMLDivElement, config: Record<string, unknown>) => GraphHandle;
let GraphCtor: CosmosCtor | null = null;

onMounted(async () => {
  try {
    const mod = await import('@cosmos.gl/graph');
    GraphCtor = (mod as { Graph: CosmosCtor }).Graph;
    // eslint-disable-next-line no-console
    console.log('[MemoryGraph] cosmos imported, Graph =', typeof GraphCtor);
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
    loading.value = false;
    // eslint-disable-next-line no-console
    console.error('[MemoryGraph] cosmos import failed', err);
    return;
  }
  loading.value = false;

  const container = containerRef.value;
  if (container === null) return;

  // Cosmos.gl needs non-zero dimensions to init its WebGL context.
  // When this component mounts inside a hidden PanesTabs tab the
  // container is `display: none` (0×0). ResizeObserver doesn't fire on
  // display:none → block transitions (no box exists), so we poll the
  // container's bounding rect and init Cosmos the first time it has
  // measurable size. Polling stops after init (or after 30s safety
  // ceiling). Once Cosmos exists, ResizeObserver handles subsequent
  // layout changes (window resize, panel drag).
  const startInitWatch = (): void => {
    const ceiling = Date.now() + 30_000;
    const tick = (): void => {
      if (graph.value !== null) return; // already initialised
      const rect = container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        initCosmos(container);
        if (graph.value !== null && typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => {
            resizeLabelCanvas();
            scheduleLabelPaint();
          });
          resizeObserver.observe(container);
        }
        return;
      }
      if (Date.now() < ceiling) setTimeout(tick, 200);
    };
    tick();
  };
  startInitWatch();
});

function initCosmos(container: HTMLDivElement): void {
  if (GraphCtor === null || graph.value !== null) return;
  try {
    // Native cosmos.gl defaults — the only config is the two callbacks
    // we need so the label overlay and zoom HUD stay in sync with what
    // the simulation does. Everything else (point size, link color,
    // physics, layout) uses cosmos's built-in choices.
    graph.value = new GraphCtor(container, {
      'onSimulationTick': () => { scheduleLabelPaint(); pollZoom(); },
      'onZoom': () => {
        scheduleLabelPaint();
        pollZoom();
        // Clamp zoom-out to fit floor (cosmos.gl has no native minZoom).
        const g = graph.value;
        const floor = fitZoomLevel.value;
        if (g !== null && floor !== null) {
          try {
            const current = g.getZoomLevel();
            if (current < floor) g.setZoomLevel(floor);
          } catch { /* ignore */ }
        }
      },
      // Cosmos passes the clicked point's index (or undefined for the
      // background). We map back to the IRI and emit `select`.
      'onClick': (index: number | undefined) => {
        if (index === undefined) { emit('select', null); return; }
        const meta = labelMeta[index];
        if (meta !== undefined) emit('select', meta.iri);
      },
    });
    resizeLabelCanvas();
    paint();
    pollZoom();
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error('[MemoryGraph] cosmos init failed', err);
  }
}

function pollZoom(): void {
  try { zoomLevel.value = graph.value?.getZoomLevel() ?? 1; } catch { /* ignore */ }
}

function mgZoomIn(): void {
  const g = graph.value;
  if (g === null) return;
  try { g.setZoomLevel(g.getZoomLevel() * 1.3); pollZoom(); } catch { /* ignore */ }
}

function mgZoomOut(): void {
  const g = graph.value;
  if (g === null) return;
  try {
    const next = g.getZoomLevel() / 1.3;
    const floor = fitZoomLevel.value ?? 0;
    g.setZoomLevel(Math.max(next, floor));
    pollZoom();
  } catch { /* ignore */ }
}

function mgFit(): void {
  try {
    graph.value?.fitView(300);
    // Capture the fit zoom after the animation settles so the floor stays current.
    setTimeout(() => {
      try {
        const level = graph.value?.getZoomLevel() ?? null;
        if (level !== null) fitZoomLevel.value = level;
      } catch { /* ignore */ }
    }, 350);
  } catch { /* ignore */ }
}

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (labelRaf !== null) cancelAnimationFrame(labelRaf);
  graph.value?.destroy();
  graph.value = null;
});

watch(() => props.tick, () => paint());
// Toggling layer chips re-runs paint so the alpha mask updates without
// disturbing the simulation.
watch(layerVisible, () => paint(), { 'deep': true });

function paint(): void {
  const handle = graph.value;
  if (handle === null) return;
  const { positions, colors, sizes, links, meta } = buildBuffers(props.store, layerVisible.value);
  labelMeta = meta;
  handle.setPointPositions(positions);
  handle.setPointColors(colors);
  handle.setPointSizes(sizes);
  handle.setLinks(links);
  // Critical: explicit render BEFORE start syncs WebGL buffers so the
  // physics step sees correct positions. Without this the first
  // simulation tick reads stale buffers and nothing visible appears.
  handle.render(0);
  if (positions.length === 0) {
    scheduleLabelPaint();
    return;
  }
  handle.start(0.9);
  // Wait long enough for the simulation to spread points before fitting.
  // Pokemontology uses 400ms + secondary at 900ms; we mirror that.
  setTimeout(() => handle.fitView(400), 400);
  setTimeout(() => {
    handle.fitView(500);
    // Capture fit zoom after the final fit settles — this becomes the zoom-out floor.
    setTimeout(() => {
      try {
        const level = graph.value?.getZoomLevel() ?? null;
        if (level !== null) fitZoomLevel.value = level;
      } catch { /* ignore */ }
    }, 550);
  }, 900);
  scheduleLabelPaint();
}

function onFrameResize(): void {
  resizeLabelCanvas();
  scheduleLabelPaint();
}

// ── Label overlay ─────────────────────────────────────────────────────────

function scheduleLabelPaint(): void {
  if (labelRaf !== null) return;
  labelRaf = requestAnimationFrame(() => {
    labelRaf = null;
    paintLabels();
  });
}

function resizeLabelCanvas(): void {
  const canvas = labelsRef.value;
  const container = containerRef.value;
  if (canvas === null || container === null) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = container.getBoundingClientRect();
  canvas.width  = Math.round(rect.width  * dpr);
  canvas.height = Math.round(rect.height * dpr);
  canvas.style.width  = `${String(rect.width)}px`;
  canvas.style.height = `${String(rect.height)}px`;
}

function paintLabels(): void {
  const handle = graph.value;
  const canvas = labelsRef.value;
  if (handle === null || canvas === null) return;
  if (canvas.width === 0 || canvas.height === 0) resizeLabelCanvas();
  const dpr = window.devicePixelRatio || 1;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = canvas.width  / dpr;
  const h = canvas.height / dpr;
  ctx.clearRect(0, 0, w, h);
  if (labelMeta.length === 0) return;

  let positions: readonly number[] = [];
  try { positions = handle.getPointPositions(); } catch (_) { return; }
  if (positions.length === 0) return;

  // Canvas font does not honour CSS vars — resolve at runtime instead.
  const mono = getComputedStyle(document.body).getPropertyValue('--vp-font-family-mono').trim()
    || 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.font = `600 13px ${mono}`;
  ctx.textBaseline = 'middle';
  const PAD_X = 5;
  const PAD_Y = 2;
  const claimed = new Set<number>();
  const BUCKET = 60;

  for (let i = 0; i < labelMeta.length; i++) {
    const wx = positions[i * 2];
    const wy = positions[i * 2 + 1];
    if (wx === undefined || wy === undefined) continue;
    let sx = 0, sy = 0;
    try {
      const p = handle.spaceToScreenPosition([wx, wy]);
      sx = p[0]; sy = p[1];
    } catch (_) { continue; }
    if (sx < 0 || sy < 0 || sx > w || sy > h) continue;
    const bx = Math.floor(sx / BUCKET);
    const by = Math.floor(sy / BUCKET);
    const key = bx * 4096 + by;
    if (claimed.has(key)) continue;
    claimed.add(key);

    const meta = labelMeta[i];
    if (meta === undefined) continue;
    const text = meta.label.length > 22 ? `${meta.label.slice(0, 20)}…` : meta.label;
    const textW = ctx.measureText(text).width;
    const pillW = textW + PAD_X * 2;
    const pillH = 13 + PAD_Y * 2;
    const x = sx + 8;
    const y = sy - pillH / 2;

    ctx.fillStyle = meta.kind === 'iri' ? 'rgba(8, 22, 32, 0.92)' : 'rgba(28, 12, 36, 0.88)';
    roundRect(ctx, x, y, pillW, pillH, 4);
    ctx.fill();

    ctx.fillStyle = meta.kind === 'iri' ? '#22e8ff' : '#c89bff';
    ctx.fillText(text, x + PAD_X, y + pillH / 2);
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  const radius = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

// ── Buffers ────────────────────────────────────────────────────────────────

interface Buffers {
  readonly positions: Float32Array;
  readonly colors:    Float32Array;
  readonly sizes:     Float32Array;
  readonly links:     Float32Array;
  readonly meta:      PointMeta[];
}

/** Layer → base RGBA (0..1). Tinted further by node-kind alpha. */
const LAYER_COLOR: Readonly<Record<GraphLayer, [number, number, number]>> = {
  'ontology': [0.13, 0.91, 0.60], // green-teal (TBox schema)
  'memory':   [0.13, 0.91, 1.00], // teal
  'state':    [0.83, 0.65, 0.29], // gold
  'prov':     [0.61, 0.32, 0.88], // violet
  'default':  [0.55, 0.55, 0.65], // neutral
};

function graphLayer(graphIri: string): GraphLayer {
  if (graphIri === 'urn:dagonizer:ontology')       return 'ontology';
  if (graphIri === 'urn:dagonizer:memory')         return 'memory';
  if (graphIri.startsWith('urn:dagonizer:state:')) return 'state';
  if (graphIri.startsWith('urn:dagonizer:prov:'))  return 'prov';
  return 'default';
}

function buildBuffers(
  store: MemoryStore,
  visible: Readonly<Record<GraphLayer, boolean>>,
): Buffers {
  const indexById = new Map<string, number>();
  const meta: PointMeta[] = [];
  const positions: number[] = [];
  const colors:    number[] = [];
  const sizes:     number[] = [];
  const links:     number[] = [];

  function intern(id: string, label: string, kind: 'iri' | 'literal', layer: GraphLayer, iri: string): number {
    const existing = indexById.get(id);
    if (existing !== undefined) return existing;
    const idx = meta.length;
    indexById.set(id, idx);
    meta.push({ label, kind, layer, iri });
    positions.push(
      4096 + (Math.random() - 0.5) * 4000,
      4096 + (Math.random() - 0.5) * 4000,
    );
    const [r, g, b] = LAYER_COLOR[layer];
    const alpha = visible[layer] ? (kind === 'iri' ? 1.0 : 0.85) : 0.04;
    colors.push(r, g, b, alpha);
    sizes.push(kind === 'iri' ? 18 : 12);
    return idx;
  }

  for (const q of store.triples()) {
    const layer = graphLayer(q.graph.value);
    const sIdx = intern(q.subject.value, localPart(q.subject.value), 'iri', layer, q.subject.value);
    const oId  = objectKey(q);
    const oKind: 'iri' | 'literal' = q.object.termType === 'Literal' ? 'literal' : 'iri';
    const oIdx = intern(oId, objectLabel(q), oKind, layer, q.object.value);
    links.push(sIdx, oIdx);
  }

  return {
    positions: new Float32Array(positions),
    colors:    new Float32Array(colors),
    sizes:     new Float32Array(sizes),
    links:     new Float32Array(links),
    meta,
  };
}

function localPart(iri: string): string {
  const hashIdx = iri.lastIndexOf('#');
  if (hashIdx >= 0) return iri.slice(hashIdx + 1);
  const slashIdx = iri.lastIndexOf('/');
  if (slashIdx >= 0) return iri.slice(slashIdx + 1);
  const colonIdx = iri.lastIndexOf(':');
  if (colonIdx >= 0) return iri.slice(colonIdx + 1);
  return iri;
}

function objectKey(q: Quad): string {
  if (q.object.termType === 'Literal') return `lit:${q.predicate.value}:${q.object.value}`;
  return q.object.value;
}

function objectLabel(q: Quad): string {
  if (q.object.termType === 'Literal') return q.object.value;
  return localPart(q.object.value);
}
</script>

<template>
  <DiagramFrame title="RDF graph" :aria-label="`RDF triple graph: ${String(store.size)} triples`" @resize="onFrameResize">
    <template #meta>
      <span class="mg-count">{{ store.size }} {{ store.size === 1 ? 'triple' : 'triples' }}</span>
    </template>
    <template #controls>
      <button
        class="frame-action frame-action-danger"
        title="Clear all triples (irreversible)"
        @click="emit('clear')"
      >🗑</button>
    </template>

    <div class="mg-canvas">
      <div v-if="loading" class="mg-overlay">Loading cosmos.gl…</div>
      <div v-else-if="loadError" class="mg-overlay mg-error">Graph failed: {{ loadError }}</div>

      <div ref="containerRef" class="mg-cosmos" aria-label="Live RDF triple graph (cosmos.gl)"></div>
      <canvas ref="labelsRef" class="mg-labels" aria-hidden="true"></canvas>

      <p v-if="!loading && !loadError && store.size === 0" class="mg-overlay mg-empty">
        No triples yet. Ask the Archivist and watch the store grow.
      </p>

      <!-- Layer legend — bottom-left corner (replaces chip filter). -->
      <GraphLegend
        v-if="!loading && !loadError"
        :tabs="memoryLegendTabs"
        class="mg-legend-pos"
        @toggle="onLayerToggle"
      />

      <!-- D-pad navigation — bottom-right corner (replaces zoom HUD + mg-dpad). -->
      <div v-if="!loading && !loadError" class="mg-dpad-pos">
        <GraphDpad
          :zoom-level="zoomLevel"
          :pan-enabled="PAN_ENABLED"
          @zoom-in="mgZoomIn"
          @zoom-out="mgZoomOut"
          @centre="mgFit"
          @fit="mgFit"
          @expand="mgZoomIn"
          @pan-up="() => {}"
          @pan-down="() => {}"
          @pan-left="() => {}"
          @pan-right="() => {}"
        />
      </div>
    </div>
  </DiagramFrame>
</template>

<style scoped>
.mg-count {
  font-family: var(--vp-font-family-mono);
  font-size: 0.7rem;
  color: var(--dagonizer-brand2);
}

.mg-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  background: radial-gradient(circle at center, rgba(155, 81, 224, 0.08), var(--vp-c-bg) 70%);
}

.mg-cosmos {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.mg-labels {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.mg-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.82rem;
  color: var(--vp-c-text-3);
  font-style: italic;
  pointer-events: none;
  padding: 0 1rem;
  text-align: center;
}

.mg-error { color: var(--dagonizer-brand3); }
.mg-empty { color: var(--vp-c-text-3); }

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
  border-color: var(--dagonizer-brand2);
  color: var(--dagonizer-brand2);
}

.frame-action-danger:hover {
  border-color: var(--dagonizer-brand3);
  color: var(--dagonizer-brand3);
}

/* Legend — bottom-left positioning anchor. */
.mg-legend-pos {
  position: absolute;
  bottom: 10px;
  left: 10px;
  z-index: 4;
}

/* D-pad — bottom-right positioning anchor. */
.mg-dpad-pos {
  position: absolute;
  bottom: 10px;
  right: 10px;
  z-index: 5;
}
</style>
