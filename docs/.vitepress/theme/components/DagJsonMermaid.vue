<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import mermaid from 'mermaid';

import type { DAGType } from '@studnicky/dagonizer';
import type { MermaidRenderOptionsType } from '@studnicky/dagonizer/viz';
import { MermaidRenderer } from '@studnicky/dagonizer/viz';

type MermaidThemeType = NonNullable<MermaidRenderOptionsType['theme']>;
type ResolvedMermaidThemeType = MermaidThemeType & {
  nodeSpacing: number;
  rankSpacing: number;
  padding: number;
};

const props = withDefaults(defineProps<{
  dag?: DAGType;
  title?: string;
  ariaLabel?: string;
  orientation?: 'TB' | 'LR' | 'RL' | 'BT';
  theme?: MermaidThemeType;
}>(), {
  orientation: 'TB',
});

const frameRef = ref<HTMLDivElement | null>(null);
const mermaidSvg = ref('');
const renderError = ref<string | null>(null);

const dagName = computed(() => props.dag?.name ?? 'unavailable-dag');
const dagVersion = computed(() => props.dag?.version ?? 'unknown');
const placementCount = computed(() => Array.isArray(props.dag?.nodes) ? props.dag.nodes.length : 0);
const heading = computed(() => props.title ?? `${dagName.value} v${dagVersion.value}`);
const jsonLd = computed(() => props.dag === undefined ? JSON.stringify({
  'error': 'DAG unavailable during documentation render.',
}, null, 2) : JSON.stringify(props.dag, null, 2));
const renderTheme = computed<ResolvedMermaidThemeType>(() => {
  const theme: ResolvedMermaidThemeType = {
    'nodeSpacing': props.theme?.nodeSpacing ?? 92,
    'rankSpacing': props.theme?.rankSpacing ?? 104,
    'padding':     props.theme?.padding     ?? 28,
  };
  if (props.theme?.primaryColor !== undefined) theme.primaryColor = props.theme.primaryColor;
  if (props.theme?.lineColor !== undefined) theme.lineColor = props.theme.lineColor;
  if (props.theme?.textColor !== undefined) theme.textColor = props.theme.textColor;
  if (props.theme?.background !== undefined) theme.background = props.theme.background;
  if (props.theme?.fontFamily !== undefined) theme.fontFamily = props.theme.fontFamily;
  if (props.theme?.fontSize !== undefined) theme.fontSize = props.theme.fontSize;
  if (props.theme?.containerTints !== undefined) theme.containerTints = props.theme.containerTints;
  return theme;
});
const mermaidSource = computed(() => MermaidRenderer.render(props.dag, {
  'orientation': props.orientation,
  'theme':       renderTheme.value,
}));

onMounted(() => {
  mermaid.initialize({
    'startOnLoad':  false,
    'securityLevel': 'strict',
    'theme':        'dark',
    'flowchart':    {
      'htmlLabels':  false,
      'nodeSpacing': renderTheme.value.nodeSpacing,
      'rankSpacing': renderTheme.value.rankSpacing,
      'padding':     renderTheme.value.padding,
      'useMaxWidth': false,
    },
    'themeVariables': {
      ...(renderTheme.value.fontFamily !== undefined ? { 'fontFamily': renderTheme.value.fontFamily } : {}),
      ...(renderTheme.value.fontSize !== undefined ? { 'fontSize': renderTheme.value.fontSize } : {}),
    },
  });
  void renderMermaid();
});

watch(mermaidSource, () => {
  void renderMermaid();
});

async function renderMermaid(): Promise<void> {
  renderError.value = null;
  if (typeof window === 'undefined') return;

  const id = `dag-json-mermaid-${dagName.value.replace(/[^a-zA-Z0-9_-]/gu, '_')}-${Math.random().toString(36).slice(2)}`;
  try {
    const result = await mermaid.render(id, mermaidSource.value);
    mermaidSvg.value = result.svg;
    await nextTick();
    if (frameRef.value !== null && typeof result.bindFunctions === 'function') {
      result.bindFunctions(frameRef.value);
    }
  } catch (caught) {
    renderError.value = caught instanceof Error ? caught.message : String(caught);
  }
}
</script>

<template>
  <section class="dag-json-mermaid" :aria-label="ariaLabel ?? `${heading} JSON-LD and Mermaid`">
    <header class="dag-json-mermaid__header">
      <h3>{{ heading }}</h3>
      <span>{{ placementCount }} placements</span>
    </header>

    <div class="dag-json-mermaid__grid">
      <figure class="dag-json-mermaid__panel">
        <figcaption>DAG JSON-LD registered with the dispatcher</figcaption>
        <pre><code>{{ jsonLd }}</code></pre>
      </figure>

      <figure class="dag-json-mermaid__panel dag-json-mermaid__diagram-panel">
        <figcaption>Mermaid generated from the same DAG</figcaption>
        <div
          ref="frameRef"
          class="mermaid dag-json-mermaid__diagram"
          v-html="mermaidSvg"
        />
        <pre v-if="renderError !== null" class="dag-json-mermaid__error"><code>{{ renderError }}</code></pre>
        <details class="dag-json-mermaid__source">
          <summary>Mermaid source</summary>
          <pre><code>{{ mermaidSource }}</code></pre>
        </details>
      </figure>
    </div>
  </section>
</template>

<style scoped>
.dag-json-mermaid {
  margin: 1.5rem 0 2rem;
  border: var(--dagonizer-surface-border);
  border-radius: var(--dagonizer-surface-radius);
  background: var(--dagonizer-surface-bg-deep);
  background-image: var(--dagonizer-surface-grain);
  background-size: var(--dagonizer-surface-grain-size);
  overflow: hidden;
}

.dag-json-mermaid__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.8rem 1rem;
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-alt);
}

.dag-json-mermaid__header h3 {
  margin: 0;
  color: var(--dagonizer-cyan);
}

.dag-json-mermaid__header span {
  font-family: var(--vp-font-family-mono);
  font-size: 0.76rem;
  color: var(--vp-c-text-2);
  white-space: nowrap;
}

.dag-json-mermaid__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0;
}

.dag-json-mermaid__panel {
  min-width: 0;
  margin: 0;
  padding: 0;
  border-right: 1px solid var(--vp-c-divider);
}

.dag-json-mermaid__panel:last-child {
  border-right: 0;
}

.dag-json-mermaid__panel figcaption {
  padding: 0.55rem 0.75rem;
  border-bottom: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-2);
  font-family: var(--vp-font-family-mono);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.dag-json-mermaid__panel pre {
  max-height: 640px;
  margin: 0;
  padding: 0.9rem;
  overflow: auto;
  background: transparent;
  font-size: 0.74rem;
  line-height: 1.45;
}

.dag-json-mermaid__diagram-panel {
  display: flex;
  flex-direction: column;
}

.dag-json-mermaid__diagram {
  min-height: 360px;
  padding: 1rem;
  overflow: auto;
}

.dag-json-mermaid__diagram :deep(svg) {
  display: block;
  width: auto;
  max-width: none;
  height: auto;
  overflow: visible;
}

.dag-json-mermaid__diagram :deep(svg *),
.dag-json-mermaid__diagram :deep(.node),
.dag-json-mermaid__diagram :deep(.nodeLabel),
.dag-json-mermaid__diagram :deep(.label),
.dag-json-mermaid__diagram :deep(.edgeLabel) {
  overflow: visible;
}

.dag-json-mermaid__source {
  border-top: 1px solid var(--vp-c-divider);
}

.dag-json-mermaid__source summary {
  cursor: pointer;
  padding: 0.55rem 0.75rem;
  color: var(--dagonizer-gold);
  font-family: var(--vp-font-family-mono);
  font-size: 0.72rem;
}

.dag-json-mermaid__error {
  color: var(--vp-c-danger-1);
  border-top: 1px solid var(--vp-c-danger-1);
}

@media (max-width: 960px) {
  .dag-json-mermaid__grid {
    grid-template-columns: 1fr;
  }

  .dag-json-mermaid__panel {
    border-right: 0;
    border-bottom: 1px solid var(--vp-c-divider);
  }

  .dag-json-mermaid__panel:last-child {
    border-bottom: 0;
  }
}
</style>
