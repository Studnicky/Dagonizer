<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import Tabs from 'primevue/tabs';
import TabList from 'primevue/tablist';
import Tab from 'primevue/tab';
import TabPanels from 'primevue/tabpanels';
import TabPanel from 'primevue/tabpanel';
import UiDocResultCard from '@/components/islands/UiDocResultCard.vue';
import { SiteDocs } from '@/lib/docs';
import UiControlPanel from '@/components/islands/UiControlPanel.vue';
import UiProofStrip from '@/components/islands/UiProofStrip.vue';

const props = defineProps<{
  docs: Awaited<ReturnType<typeof SiteDocs.catalog>>;
  sections: Awaited<ReturnType<typeof SiteDocs.sections>>;
}>();

const query = ref('');
const sortOption = ref<'title' | 'density'>('title');
const activeSection = ref<string>(props.sections[0]?.name ?? 'all');

// Global nav search submits here as `?q=<term>`, so the query box arrives
// pre-filled for a visitor coming from any other page's search field.
onMounted(() => {
  const fromUrl = new URLSearchParams(window.location.search).get('q');
  if (fromUrl !== null && fromUrl.trim().length > 0) {
    query.value = fromUrl;
  }
});

const sortOptions = [
  { label: 'Sort: title', value: 'title' },
  { label: 'Sort: densest pages', value: 'density' }
];

const filteredSections = computed(() => {
  const normalizedQuery = query.value.trim().toLowerCase();

  return props.sections
    .map((section) => {
      const entries = section.entries.filter((entry) => {
        if (normalizedQuery.length === 0) {
          return true;
        }

        const haystack = [entry.title, entry.description, entry.excerpt, ...entry.headings].join(' ').toLowerCase();
        return haystack.includes(normalizedQuery);
      });

      const sortedEntries = [...entries].sort((left, right) => {
        if (sortOption.value === 'density') {
          return right.headings.length - left.headings.length || left.title.localeCompare(right.title);
        }

        return left.title.localeCompare(right.title);
      });

      return {
        name: section.name,
        entries: sortedEntries
      };
    })
    .filter((section) => section.entries.length > 0);
});

const matchingCount = computed(() => filteredSections.value.reduce((count, section) => count + section.entries.length, 0));
const tabValue = computed(() =>
  filteredSections.value.some((section) => section.name === activeSection.value)
    ? activeSection.value
    : filteredSections.value[0]?.name ?? 'all'
);
</script>

<template>
  <div class="space-y-6">
    <UiControlPanel>
      <label class="space-y-2">
        <span class="text-xs uppercase tracking-[0.24em] text-slate-500">Search docs</span>
        <InputText v-model="query" placeholder="checkpoint, scatter, visualization, plugins..." />
      </label>
      <label class="space-y-2">
        <span class="text-xs uppercase tracking-[0.24em] text-slate-500">Sort</span>
        <Select v-model="sortOption" :options="sortOptions" option-label="label" option-value="value" />
      </label>
    </UiControlPanel>

    <UiProofStrip
      :label="`${matchingCount} matched pages`"
      detail="Search runs across titles, descriptions, excerpts, and extracted headings from the current documentation catalog."
    />

    <Tabs :value="tabValue">
      <TabList>
        <Tab
          v-for="section in filteredSections"
          :key="section.name"
          :value="section.name"
          @click="activeSection = section.name"
        >
          {{ section.name }} · {{ section.entries.length }}
        </Tab>
      </TabList>
      <TabPanels>
        <TabPanel v-for="section in filteredSections" :key="section.name" :value="section.name">
          <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <UiDocResultCard v-for="entry in section.entries" :key="entry.slug" :entry="entry" />
          </div>
        </TabPanel>
      </TabPanels>
    </Tabs>
  </div>
</template>
