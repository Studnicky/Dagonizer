<script setup lang="ts">
import Card from 'primevue/card';

type ProofItem = {
  title: string;
  body: string;
};

defineProps<{
  title: string;
  items: readonly ProofItem[];
}>();
</script>

<template>
  <section class="space-y-4">
    <h2 class="text-2xl font-semibold text-white">{{ title }}</h2>
    <div class="grid gap-4 md:grid-cols-3">
      <Card v-for="item in items" :key="item.title" class="h-full">
        <template #title>{{ item.title }}</template>
        <template #content>
          <p class="text-sm leading-6 text-slate-300">{{ item.body }}</p>
        </template>
      </Card>
    </div>
  </section>
</template>
