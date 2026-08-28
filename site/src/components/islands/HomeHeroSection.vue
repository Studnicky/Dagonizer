<script setup lang="ts">
import Card from 'primevue/card';
import Tag from 'primevue/tag';
import UiActionLink from '@/components/islands/UiActionLink.vue';
import UiCtaRow from '@/components/islands/UiCtaRow.vue';
import UiHeroShell from '@/components/islands/UiHeroShell.vue';

const runtimeBadges = [
  { label: 'scatter', tone: 'cyan' },
  { label: 'gather', tone: 'violet' },
  { label: 'resume', tone: 'cyan' }
] as const;

const runtimePoints = [
  {
    label: 'Execution model',
    body: 'Typed routes, terminals, fan-out, and gather behavior stay in one registered DAG document.'
  },
  {
    label: 'Runtime continuity',
    body: 'Checkpoint resume preserves workflow state and the execution cursor instead of reconstructing control flow in application glue.'
  },
  {
    label: 'Shared DAG document',
    body: 'Guides, live examples, visualization, and execution all read the same DAG shape.'
  }
] as const;

const visualPanels = [
  {
    label: 'Author',
    title: 'Author JSON-LD DAGs or build them fluently',
    body: 'Define placements, routes, terminals, and graph identity directly so workflow structure survives code review and long-term maintenance.'
  },
  {
    label: 'Execute',
    title: 'Run with checkpoints, retries, and cancellation',
    body: 'Execute the same DAG with scatter, gather, deadlines, and resume boundaries instead of rebuilding control flow in host-specific glue.'
  },
  {
    label: 'Inspect',
    title: 'Read the same graph across tools',
    body: 'Use one DAG document across guides, live examples, visualization, and operational review instead of maintaining separate graph descriptions.'
  }
] as const;

defineProps<{
  gettingStartedHref: string;
  visualizeHref: string;
}>();
</script>

<template>
  <UiHeroShell
    title="Typed DAG orchestration for agent systems, data pipelines, and resumable workflows."
    description="Dagonizer is a TypeScript runtime for authoring JSON-LD DAGs, registering typed nodes, executing them with scatter/gather and checkpoints, and carrying the same workflow shape across docs, live examples, and production tooling."
  >
    <template #visual>
      <div
        class="hero-pulse hex-cell absolute right-12 top-8 w-40 border-0 bg-cyan-400/14 blur-3xl"
        style="aspect-ratio: var(--dagonizer-hex-ratio);"
      ></div>
      <div class="absolute inset-0 flex items-center justify-center">
        <div class="relative w-full max-w-[30rem] space-y-5">
          <div class="hex-tile bg-cyan-400/6 px-6 py-5 shadow-[0_24px_80px_-40px_rgba(34,232,255,0.24)]">
            <div class="flex items-center justify-between gap-5">
              <div class="space-y-1">
                <p class="text-[11px] font-semibold uppercase tracking-[0.26em] text-cyan-100">DAG document</p>
                <p class="text-sm text-slate-300">One workflow definition is authored, executed, and rendered across the stack.</p>
              </div>
              <div class="flex flex-wrap justify-end gap-2.5">
                <Tag
                  v-for="badge in runtimeBadges"
                  :key="badge.label"
                  :value="badge.label"
                  :class="
                    badge.tone === 'violet'
                      ? '!border-violet-400/25 !bg-violet-400/10 !text-violet-100'
                      : '!border-cyan-400/25 !bg-cyan-400/10 !text-cyan-100'
                  "
                />
              </div>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <Card
              v-for="(panel, index) in visualPanels"
              :key="panel.label"
              :class="index === 0 ? 'col-span-2' : ''"
            >
              <template #content>
                <div class="space-y-3">
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">{{ panel.label }}</span>
                    <span
                      class="hex-cell w-2.5 border-0 bg-cyan-300"
                      style="aspect-ratio: var(--dagonizer-hex-ratio);"
                    ></span>
                  </div>
                  <div>
                    <h3 class="text-base font-semibold text-white">{{ panel.title }}</h3>
                    <p class="mt-2 text-sm leading-6 text-slate-300">{{ panel.body }}</p>
                  </div>
                </div>
              </template>
            </Card>
          </div>
        </div>
      </div>
    </template>

    <template #eyebrow>
      <div class="flex flex-wrap items-center gap-3">
        <Tag value="Typed orchestration runtime" />
        <span class="text-xs uppercase tracking-[0.28em] text-slate-500">JSON-LD · checkpoints · scatter/gather</span>
      </div>
    </template>

    <template #actions>
      <UiCtaRow>
        <UiActionLink :href="gettingStartedHref" variant="primary" label="Get started" />
        <UiActionLink :href="visualizeHref" label="See visualization model" />
      </UiCtaRow>
    </template>

    <template #supporting>
      <div class="grid gap-4 md:grid-cols-3">
        <div
          v-for="point in runtimePoints"
          :key="point.label"
          class="hex-tile bg-white/4 px-5 py-5"
        >
          <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">{{ point.label }}</p>
          <p class="mt-2 text-sm leading-6 text-slate-300">{{ point.body }}</p>
        </div>
      </div>
    </template>
  </UiHeroShell>
</template>
