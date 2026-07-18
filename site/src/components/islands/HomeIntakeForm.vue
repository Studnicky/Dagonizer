<script setup lang="ts">
import { ref } from 'vue';
import Button from 'primevue/button';
import Card from 'primevue/card';
import Select from 'primevue/select';
import InputText from 'primevue/inputtext';
import Textarea from 'primevue/textarea';
import { SiteLinks } from '@/lib/links';

const roleOptions = [
  { label: 'LLM agent orchestration', value: 'agents' },
  { label: 'Data pipelines / ETL', value: 'etl' },
  { label: 'Browser demos / visualization', value: 'viz' }
];

const selectedRole = ref(roleOptions[0]);
const email = ref('');
const problem = ref('We need deterministic orchestration, live diagram feedback, and resumable checkpoints.');
</script>

<template>
  <Card>
    <template #subtitle>Evaluation path</template>
    <template #title>Start from the workflow you actually need to run</template>
    <template #content>
      <div class="grid gap-4 md:grid-cols-2">
        <label class="space-y-2">
          <span class="text-xs uppercase tracking-[0.24em] text-slate-500">Primary use case</span>
          <Select v-model="selectedRole" option-label="label" :options="roleOptions" fluid />
        </label>
        <label class="space-y-2">
          <span class="text-xs uppercase tracking-[0.24em] text-slate-500">Contact</span>
          <InputText v-model="email" placeholder="team@company.com" />
        </label>
        <label class="space-y-2 md:col-span-2">
          <span class="text-xs uppercase tracking-[0.24em] text-slate-500">What are you orchestrating?</span>
          <Textarea v-model="problem" />
        </label>
        <div class="md:col-span-2 flex flex-wrap gap-3">
          <Button label="Review workflow fit" />
          <Button as="a" :href="SiteLinks.site('/docs/examples/the-archivist')" label="Open examples" variant="outlined" severity="contrast" />
        </div>
      </div>
    </template>
  </Card>
</template>
