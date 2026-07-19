<script setup lang="ts">
import Card from 'primevue/card';
import Accordion from 'primevue/accordion';
import AccordionPanel from 'primevue/accordionpanel';
import AccordionHeader from 'primevue/accordionheader';
import AccordionContent from 'primevue/accordioncontent';

const faqs = [
  {
    value: '0',
    title: 'What kind of workflows fit Dagonizer?',
    body: 'Dagonizer fits agent graphs, deterministic processing pipelines, and mixed workflows that need visible fan-out, fan-in, checkpoints, or operator handoff.'
  },
  {
    value: '1',
    title: 'Why use a DAG instead of implicit orchestration?',
    body: 'A DAG makes routing, concurrency, retries, and terminal outcomes explicit. That keeps the control path in the workflow document instead of burying it in host callbacks.'
  },
  {
    value: '2',
    title: 'What does the visualization layer add?',
    body: 'It renders Mermaid, JSON-LD, and Cytoscape views from the same DAG document the dispatcher executes, so docs and tools do not need a second graph format.'
  }
] as const;
</script>

<template>
  <Card>
    <template #subtitle>Runtime scope</template>
    <template #title>Workflows the runtime is built to handle</template>
    <template #content>
      <Accordion value="0">
        <AccordionPanel v-for="item in faqs" :key="item.value" :value="item.value">
          <AccordionHeader>{{ item.title }}</AccordionHeader>
          <AccordionContent>
            {{ item.body }}
          </AccordionContent>
        </AccordionPanel>
      </Accordion>
    </template>
  </Card>
</template>
