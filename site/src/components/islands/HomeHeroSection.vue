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

const proofPoints = [
  {
    label: 'Execution model',
    body: 'Typed routes, terminals, fan-out, and gather behavior stay in one visible graph contract.'
  },
  {
    label: 'Runtime continuity',
    body: 'Checkpoint resume preserves the same workflow state instead of reconstructing orchestration context.'
  },
  {
    label: 'Shared surface',
    body: 'Docs, examples, visualization, and execution all anchor to the same DAG shape.'
  }
] as const;

const visualPanels = [
  {
    label: 'Author',
    title: 'Define the workflow explicitly',
    body: 'Describe placements, branches, terminals, and graph identity without hiding orchestration inside app glue.'
  },
  {
    label: 'Execute',
    title: 'Run with checkpoints and control points',
    body: 'Pause, resume, retry, and route the same DAG under real runtime conditions instead of reconstructing state ad hoc.'
  },
  {
    label: 'Inspect',
    title: 'Use the same graph across surfaces',
    body: 'Docs, examples, and visualization stay attached to the real workflow model teams actually operate.'
  }
] as const;

defineProps<{
  gettingStartedHref: string;
  visualizeHref: string;
}>();
</script>

<template>
  <UiHeroShell
    title="One engine for typed agent graphs, data pipelines, and live DAG visualization."
    description="Build workflows that stay explicit from graph definition to runtime behavior. Dagonizer gives teams a typed DAG model for orchestration, checkpointed execution, and inspection surfaces that make complex flows understandable."
  >
    <template #visual>
      <div class="hero-pulse absolute right-12 top-8 h-40 w-40 rounded-full bg-cyan-400/14 blur-3xl"></div>
      <div class="absolute inset-0 flex items-center justify-center">
        <div class="relative w-full max-w-[30rem] space-y-4">
          <div class="rounded-3xl border border-cyan-400/18 bg-cyan-400/6 px-5 py-4 shadow-[0_24px_80px_-40px_rgba(34,232,255,0.24)]">
            <div class="flex items-center justify-between gap-4">
              <div class="space-y-1">
                <p class="text-[11px] font-semibold uppercase tracking-[0.26em] text-cyan-100">Workflow surface</p>
                <p class="text-sm text-slate-300">One graph moves from authoring to runtime to inspection.</p>
              </div>
              <div class="flex flex-wrap justify-end gap-2">
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

          <div class="grid gap-3">
            <Card
              v-for="(panel, index) in visualPanels"
              :key="panel.label"
              :class="index === 1 ? 'translate-x-6' : index === 2 ? 'translate-x-12' : ''"
            >
              <template #content>
                <div class="space-y-3">
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">{{ panel.label }}</span>
                    <span class="h-2.5 w-2.5 rounded-full bg-cyan-300"></span>
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
        <span class="text-xs uppercase tracking-[0.28em] text-slate-500">Agents · pipelines · visualization</span>
      </div>
    </template>

    <template #actions>
      <UiCtaRow>
        <UiActionLink :href="gettingStartedHref" variant="primary" label="Get started" />
        <UiActionLink :href="visualizeHref" label="See visualization model" />
      </UiCtaRow>
    </template>

    <template #supporting>
      <div class="grid gap-3 md:grid-cols-3">
        <div
          v-for="point in proofPoints"
          :key="point.label"
          class="rounded-2xl border border-white/8 bg-white/4 px-4 py-4"
        >
          <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">{{ point.label }}</p>
          <p class="mt-2 text-sm leading-6 text-slate-300">{{ point.body }}</p>
        </div>
      </div>
    </template>
  </UiHeroShell>
</template>
