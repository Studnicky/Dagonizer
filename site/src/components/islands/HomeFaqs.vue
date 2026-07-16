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
    body: 'A DAG makes routing, concurrency, retries, and terminal outcomes explicit. That improves inspection, debugging, and confidence when workflows become operationally important.'
  },
  {
    value: '2',
    title: 'What does the visualization layer add?',
    body: 'It gives users a readable surface for the same workflow they execute, document, review, and integrate, instead of forcing separate representations for each use case.'
  }
] as const;
</script>

<template>
  <Card>
    <template #subtitle>Product fit</template>
    <template #title>Where Dagonizer earns its keep</template>
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
