<script setup lang="ts">
import Breadcrumb from 'primevue/breadcrumb';
import { computed } from 'vue';

type Crumb = {
  href: string;
  label: string;
};

const props = defineProps<{
  title: string;
  description: string;
  crumbs: readonly Crumb[];
}>();

const breadcrumbItems = computed(() => props.crumbs.map((crumb) => ({ label: crumb.label, url: crumb.href })));
</script>

<template>
  <div class="max-w-4xl space-y-4 border-b border-white/8 pb-8">
    <Breadcrumb :model="breadcrumbItems">
      <template #item="{ item, props: itemProps }">
        <a
          v-bind="itemProps.action"
          :href="item.url"
          class="rounded-md text-xs uppercase tracking-[0.24em] text-slate-500 transition hover:text-slate-300"
        >
          {{ item.label }}
        </a>
      </template>
    </Breadcrumb>
    <h1 class="text-3xl font-semibold tracking-tight text-white md:text-5xl">{{ title }}</h1>
    <p class="text-base leading-7 text-slate-300 md:text-lg">{{ description }}</p>
  </div>
</template>
