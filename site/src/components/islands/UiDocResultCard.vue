<script setup lang="ts">
import Button from 'primevue/button';
import Card from 'primevue/card';
import Tag from 'primevue/tag';
import { SiteDocs } from '@/lib/docs';
import { SiteLinks } from '@/lib/links';

const props = defineProps<{
  entry: Awaited<ReturnType<typeof SiteDocs.catalog>>[number];
}>();

function toDisplaySection(section: string): string {
  return section
    .replace(/^\d+-/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
</script>

<template>
  <Card class="h-full">
    <template #subtitle>
      <div class="flex items-center justify-between gap-3">
        <Tag :value="toDisplaySection(props.entry.section)" class="!text-slate-100" />
        <Tag :value="`${props.entry.headings.length} headings`" class="!border-white/10 !bg-white/4 !text-slate-300" />
      </div>
    </template>
    <template #title>{{ props.entry.title }}</template>
    <template #content>
      <div class="space-y-4">
        <p>{{ props.entry.description || props.entry.excerpt }}</p>
        <div class="flex flex-wrap gap-2">
          <Tag
            v-for="heading in props.entry.headings.slice(0, 3)"
            :key="heading"
            :value="heading"
            class="!border-white/10 !bg-white/4 !text-slate-300"
          />
        </div>
        <Button as="a" :href="SiteLinks.site(props.entry.url)" label="Open page" variant="outlined" severity="contrast" />
      </div>
    </template>
  </Card>
</template>
