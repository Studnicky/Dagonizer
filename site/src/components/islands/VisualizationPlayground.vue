<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import Select from 'primevue/select';
import Tabs from 'primevue/tabs';
import TabList from 'primevue/tablist';
import Tab from 'primevue/tab';
import TabPanels from 'primevue/tabpanels';
import TabPanel from 'primevue/tabpanel';
import Card from 'primevue/card';
import Button from 'primevue/button';
import UiControlPanel from '@/components/islands/UiControlPanel.vue';
import UiPanelShell from '@/components/islands/UiPanelShell.vue';
import UiProofStrip from '@/components/islands/UiProofStrip.vue';

import type { DAGType } from '@studnicky/dagonizer';
import {
  archivistDAG,
  cartographerDAG,
  supportDispatcherDAG
} from '../../../../docs/exampleDags.ts';

type OrientationType = 'TB' | 'LR' | 'RL' | 'BT';

interface PlaygroundOption {
  readonly label: string;
  readonly value: string;
  readonly dag: DAGType;
  readonly description: string;
}

const dagOptions: readonly PlaygroundOption[] = [
  {
    label: 'The Archivist',
    value: 'archivist',
    dag: archivistDAG,
    description: 'LLM-agent orchestration with search, compose, validation, and bounded retry.'
  },
  {
    label: 'The Dispatcher',
    value: 'dispatcher',
    dag: supportDispatcherDAG,
    description: 'Routing and human handoff flow with checkpoint-friendly control boundaries.'
  },
  {
    label: 'The Cartographer',
    value: 'cartographer',
    dag: cartographerDAG,
    description: 'Streaming ETL DAG with ingest, normalization, geo-resolution, and insights.'
  }
];

const orientationOptions = [
  { label: 'Top to bottom', value: 'TB' },
  { label: 'Left to right', value: 'LR' },
  { label: 'Right to left', value: 'RL' },
  { label: 'Bottom to top', value: 'BT' }
] as const;

const activeDag = ref<PlaygroundOption>(dagOptions[0]);
const activeOrientation = ref<OrientationType>('TB');
const activeTab = ref('render');
const renderContainer = ref<HTMLDivElement | null>(null);
const mermaidSvg = ref('');
const renderError = ref<string | null>(null);
const mermaidSource = ref('');
const jsonLdSource = ref('');
const renderReady = ref(false);

const selectedDag = computed(() => activeDag.value.dag);
const placementCount = computed(() => selectedDag.value.nodes.length);

onMounted(() => {
  void initializeRenderer();
});

watch([activeDag, activeOrientation], () => {
  void updateRenderedSources();
});

async function initializeRenderer(): Promise<void> {
  const [{ default: mermaid }] = await Promise.all([import('mermaid')]);

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'dark',
    flowchart: {
      htmlLabels: false,
      useMaxWidth: false
    }
  });

  renderReady.value = true;
  await updateRenderedSources();
}

async function updateRenderedSources(): Promise<void> {
  if (!renderReady.value) {
    return;
  }

  const [{ MermaidRenderer, JsonLdRenderer }] = await Promise.all([import('@studnicky/dagonizer/viz')]);

  mermaidSource.value = MermaidRenderer.render(selectedDag.value, {
    orientation: activeOrientation.value,
    theme: {
      primaryColor: '#22e8ff',
      lineColor: '#8f6dff',
      textColor: '#e2e8f0',
      background: '#07111f',
      fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      fontSize: 15,
      nodeSpacing: 88,
      rankSpacing: 106,
      padding: 28
    }
  });
  jsonLdSource.value = JSON.stringify(JsonLdRenderer.render(selectedDag.value), null, 2);
  await renderMermaid();
}

async function renderMermaid(): Promise<void> {
  if (!renderReady.value) {
    return;
  }

  renderError.value = null;

  try {
    const { default: mermaid } = await import('mermaid');
    const renderId = `astro-viz-${activeDag.value.value}-${activeOrientation.value}-${Math.random().toString(36).slice(2)}`;
    const result = await mermaid.render(renderId, mermaidSource.value);
    mermaidSvg.value = result.svg;
    await nextTick();
    if (renderContainer.value !== null && typeof result.bindFunctions === 'function') {
      result.bindFunctions(renderContainer.value);
    }
  } catch (error) {
    renderError.value = error instanceof Error ? error.message : String(error);
  }
}

async function copySource(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}
</script>

<template>
  <div class="space-y-6">
    <UiControlPanel>
      <label class="space-y-2">
        <span class="text-xs uppercase tracking-[0.24em] text-slate-500">Example DAG</span>
        <Select v-model="activeDag" :options="dagOptions" option-label="label">
          <template #option="{ option }">
            <div class="space-y-1 py-1">
              <div class="text-sm text-slate-100">{{ option.label }}</div>
              <div class="text-xs leading-5 text-slate-400">{{ option.description }}</div>
            </div>
          </template>
        </Select>
      </label>

      <label class="space-y-2">
        <span class="text-xs uppercase tracking-[0.24em] text-slate-500">Orientation</span>
        <Select v-model="activeOrientation" :options="orientationOptions" option-label="label" option-value="value" />
      </label>

      <UiPanelShell title="Runtime facts">
        <UiProofStrip :label="`${placementCount} placements`" :detail="activeDag.description" />
      </UiPanelShell>
    </UiControlPanel>

    <Tabs v-model:value="activeTab">
      <TabList>
        <Tab value="render">Mermaid render</Tab>
        <Tab value="source">Mermaid source</Tab>
        <Tab value="jsonld">JSON-LD</Tab>
      </TabList>
      <TabPanels>
        <TabPanel value="render">
          <UiPanelShell :title="activeDag.label" subtitle="Live renderer output">
            <div class="space-y-4">
              <div
                ref="renderContainer"
                class="hex-tile overflow-auto bg-slate-950/88 p-5"
                v-html="mermaidSvg"
              />
              <p v-if="!renderReady" class="text-sm text-slate-400">Loading renderer…</p>
              <p v-if="renderError" class="hex-chrome border-rose-400/20 bg-rose-400/8 px-5 py-3.5 text-sm text-rose-100">
                {{ renderError }}
              </p>
            </div>
          </UiPanelShell>
        </TabPanel>

        <TabPanel value="source">
          <UiPanelShell title="Mermaid source" subtitle="Renderer output">
            <div class="space-y-4">
              <div class="flex justify-end">
                <Button label="Copy source" variant="outlined" severity="contrast" @click="copySource(mermaidSource)" />
              </div>
              <pre class="hex-tile overflow-auto bg-slate-950/88 p-5 text-xs leading-6 text-slate-200"><code>{{ mermaidSource }}</code></pre>
            </div>
          </UiPanelShell>
        </TabPanel>

        <TabPanel value="jsonld">
          <UiPanelShell title="JSON-LD" subtitle="Canonical payload">
            <div class="space-y-4">
              <div class="flex justify-end">
                <Button label="Copy JSON-LD" variant="outlined" severity="contrast" @click="copySource(jsonLdSource)" />
              </div>
              <pre class="hex-tile overflow-auto bg-slate-950/88 p-5 text-xs leading-6 text-slate-200"><code>{{ jsonLdSource }}</code></pre>
            </div>
          </UiPanelShell>
        </TabPanel>
      </TabPanels>
    </Tabs>
  </div>
</template>

<style scoped>
:deep(.node rect),
:deep(.node polygon),
:deep(.node path),
:deep(.node circle) {
  filter: drop-shadow(0 10px 24px rgba(2, 6, 23, 0.4));
}

:deep(svg) {
  display: block;
  min-width: 100%;
  height: auto;
}
</style>
