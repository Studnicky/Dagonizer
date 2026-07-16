<script setup lang="ts">
import Card from 'primevue/card';
import Tag from 'primevue/tag';
import Tabs from 'primevue/tabs';
import TabList from 'primevue/tablist';
import Tab from 'primevue/tab';
import TabPanels from 'primevue/tabpanels';
import TabPanel from 'primevue/tabpanel';
import UiActionLink from '@/components/islands/UiActionLink.vue';
import UiCtaRow from '@/components/islands/UiCtaRow.vue';
import { siteHref } from '@/lib/links';

type UseCase = {
  readonly key: string;
  readonly label: string;
  readonly title: string;
  readonly summary: string;
  readonly capabilities: readonly string[];
  readonly primaryHref: string;
  readonly primaryLabel: string;
  readonly secondaryHref: string;
  readonly secondaryLabel: string;
};

const useCases: readonly UseCase[] = [
  {
    key: 'agents',
    label: 'Agents',
    title: 'Agent workflows with explicit routing and durable checkpoints',
    summary:
      'Keep tool use, retries, operator handoff, and downstream routing inside one visible DAG instead of scattering orchestration logic across app code.',
    capabilities: [
      'Typed terminals and branch outputs keep control flow inspectable.',
      'Checkpoint resume preserves execution context for long-running or interrupted runs.',
      'Visualization surfaces expose the same workflow operators execute.'
    ],
    primaryHref: siteHref('/docs/examples/the-archivist'),
    primaryLabel: 'Open Archivist example',
    secondaryHref: siteHref('/docs/guide/checkpoint'),
    secondaryLabel: 'Read checkpoint guide'
  },
  {
    key: 'handoff',
    label: 'Handoff',
    title: 'Human-in-the-loop control without parking a worker indefinitely',
    summary:
      'Park execution at a real runtime boundary, persist state, and resume from the recorded cursor when the external decision arrives.',
    capabilities: [
      'Correlation keys and resume cursors are first-class runtime concepts.',
      'Hosts can release workers instead of simulating suspension.',
      'The resumed run continues the same DAG rather than rebuilding context ad hoc.'
    ],
    primaryHref: siteHref('/docs/examples/the-dispatcher'),
    primaryLabel: 'Open Dispatcher example',
    secondaryHref: siteHref('/docs/guide/hitl'),
    secondaryLabel: 'Read HITL guide'
  },
  {
    key: 'streaming',
    label: 'Streaming',
    title: 'Streaming DAGs that stay readable under fan-out and fan-in',
    summary:
      'Model intake, normalization, concurrency, gather behavior, and downstream enrichment directly in the graph so operational behavior remains legible.',
    capabilities: [
      'Streaming producers feed work over time without inventing a second execution model.',
      'Scatter and gather stay graph-native instead of hidden queue glue.',
      'Teams can document, inspect, and tune the same workflow artifact.'
    ],
    primaryHref: siteHref('/docs/examples/the-cartographer'),
    primaryLabel: 'Open Cartographer example',
    secondaryHref: siteHref('/docs/guide/streaming-producers'),
    secondaryLabel: 'Read streaming guide'
  }
] as const;
</script>

<template>
  <Card>
    <template #subtitle>Use-case fit</template>
    <template #title>Match the runtime model to the workflow you need to operate</template>
    <template #content>
      <Tabs value="agents">
        <TabList>
          <Tab v-for="useCase in useCases" :key="useCase.key" :value="useCase.key">
            {{ useCase.label }}
          </Tab>
        </TabList>

        <TabPanels>
          <TabPanel v-for="useCase in useCases" :key="useCase.key" :value="useCase.key">
            <div class="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
              <div class="space-y-4">
                <div class="space-y-3">
                  <Tag :value="useCase.label" class="!border-cyan-400/25 !bg-cyan-400/10 !text-cyan-100" />
                  <h3 class="text-xl font-semibold text-white">{{ useCase.title }}</h3>
                  <p class="text-sm leading-6 text-slate-300">{{ useCase.summary }}</p>
                </div>

                <ul class="space-y-3 text-sm leading-6 text-slate-300">
                  <li
                    v-for="capability in useCase.capabilities"
                    :key="capability"
                    class="rounded-xl border border-white/8 bg-white/4 px-4 py-3"
                  >
                    {{ capability }}
                  </li>
                </ul>
              </div>

              <Card class="h-full">
                <template #subtitle>Next step</template>
                <template #title>Inspect the runnable example and the runtime contract</template>
                <template #content>
                  <div class="space-y-4">
                    <p class="text-sm leading-6 text-slate-300">
                      Use the example to inspect the concrete workflow shape, then move into the guide for the execution contract behind it.
                    </p>

                    <UiCtaRow class="flex-col items-stretch">
                      <UiActionLink :href="useCase.primaryHref" variant="primary" :label="useCase.primaryLabel" />
                      <UiActionLink :href="useCase.secondaryHref" :label="useCase.secondaryLabel" />
                    </UiCtaRow>
                  </div>
                </template>
              </Card>
            </div>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </template>
  </Card>
</template>
