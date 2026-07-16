<script setup lang="ts">
import Button from 'primevue/button';
import Card from 'primevue/card';
import Tag from 'primevue/tag';
import { siteHref } from '@/lib/links';

interface DocEntry {
  readonly slug: string;
  readonly url: string;
  readonly section: string;
  readonly title: string;
  readonly description: string;
  readonly excerpt: string;
  readonly headings: readonly string[];
}

defineProps<{
  entry: DocEntry;
}>();
</script>

<template>
  <Card class="h-full">
    <template #subtitle>
      <div class="flex items-center justify-between gap-3">
        <Tag :value="entry.section" class="!text-slate-100" />
        <Tag :value="`${entry.headings.length} headings`" class="!border-white/10 !bg-white/4 !text-slate-300" />
      </div>
    </template>
    <template #title>{{ entry.title }}</template>
    <template #content>
      <div class="space-y-4">
        <p>{{ entry.description || entry.excerpt }}</p>
        <div class="flex flex-wrap gap-2">
          <Tag
            v-for="heading in entry.headings.slice(0, 3)"
            :key="heading"
            :value="heading"
            class="!border-white/10 !bg-white/4 !text-slate-300"
          />
        </div>
        <Button as="a" :href="siteHref(entry.url)" label="Open page" variant="outlined" severity="contrast" />
      </div>
    </template>
  </Card>
</template>
