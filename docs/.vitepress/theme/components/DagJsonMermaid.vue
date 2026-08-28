<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import mermaid from 'mermaid';
import UiCodeBlock from './ui/UiCodeBlock.vue';
import UiCodeTabs from './ui/UiCodeTabs.vue';
import PanelHeader from './ui/PanelHeader.vue';

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
const sourceTabs = computed(() => [
  { 'key': 'jsonld', 'label': 'JSON-LD', 'tone': 'accent' as const },
  { 'key': 'mermaid', 'label': 'Mermaid source' },
]);

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
      <UiCodeTabs
        class="dag-json-mermaid__panel dag-json-mermaid__sources"
        :tabs="sourceTabs"
        default-key="jsonld"
        aria-label="DAG sources"
      >
        <template #jsonld>
          <UiCodeBlock
            title="DAG JSON-LD"
            meta="Dispatcher payload"
            :code="jsonLd"
            tone="source"
          />
        </template>
        <template #mermaid>
          <UiCodeBlock
            title="Mermaid source"
            meta="Generated renderer output"
            :code="mermaidSource"
            tone="source"
          />
        </template>
      </UiCodeTabs>

      <figure class="dag-json-mermaid__panel dag-json-mermaid__diagram-panel">
        <PanelHeader
          class="dag-json-mermaid__panel-header"
          title="Mermaid render"
          meta="Generated from the same DAG"
          variant="band"
          accent="brand"
        />
        <div
          ref="frameRef"
          class="mermaid dag-json-mermaid__diagram"
          v-html="mermaidSvg"
        />
        <UiCodeBlock
          v-if="renderError !== null"
          class="dag-json-mermaid__error"
          title="Render error"
          meta="Mermaid rejected the generated source"
          :code="renderError"
          tone="error"
        >
        </UiCodeBlock>
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

.dag-json-mermaid__diagram-panel {
  display: flex;
  flex-direction: column;
}

.dag-json-mermaid__sources {
  border-right: 1px solid var(--vp-c-divider);
}

.dag-json-mermaid__sources :deep(.ui-tabs),
.dag-json-mermaid__sources :deep(.ui-code-block) {
  height: 100%;
  border: 0;
  border-radius: 0;
}

.dag-json-mermaid__panel-header {
  :deep(.dg-panel-header__title) {
    font-family: var(--vp-font-family-display);
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.05em;
  }

  :deep(.dg-panel-header__meta) {
    font-size: 0.7rem;
  }
}

.dag-json-mermaid__diagram {
  flex: 1 1 auto;
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

.dag-json-mermaid__error {
  margin: 0;
  border-left: 0;
  border-right: 0;
  border-bottom: 0;
  border-radius: 0;
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
