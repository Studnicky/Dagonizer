<script setup lang="ts">
import Card from 'primevue/card';
import Tag from 'primevue/tag';
import UiLinkCard from '@/components/islands/UiLinkCard.vue';

type CardItem = {
  eyebrow?: string;
  badge?: string;
  title: string;
  body: string;
  href?: string;
};

const props = withDefaults(
  defineProps<{
    items: CardItem[];
    columns?: '3';
    sectionId?: string;
    linkCards?: boolean;
    titleSize?: 'base' | 'large';
  }>(),
  {
    columns: '3',
    sectionId: undefined,
    linkCards: false,
    titleSize: 'base'
  }
);
</script>

<template>
  <section :id="sectionId" class="grid gap-5 md:grid-cols-3">
    <template v-for="item in items" :key="`${item.title}-${item.eyebrow ?? item.badge ?? ''}`">
      <UiLinkCard
        v-if="item.href && linkCards"
        :href="item.href"
        :eyebrow="item.eyebrow"
        :title="item.title"
        :body="item.body"
      />

      <Card v-else class="h-full">
        <template #title>
          <div class="space-y-3">
            <div v-if="item.eyebrow || item.badge" class="flex items-center gap-3">
              <Tag v-if="item.badge" :value="item.badge" class="!h-10 !w-10 !justify-center !rounded-xl !px-0 !py-0 !text-sm" />
              <p v-if="item.eyebrow" class="text-xs uppercase tracking-[0.24em] text-slate-500">{{ item.eyebrow }}</p>
            </div>
            <h2
              :class="[
                'font-semibold text-white transition',
                titleSize === 'large' ? 'text-2xl group-hover:text-cyan-100' : 'text-lg'
              ]"
            >
              {{ item.title }}
            </h2>
          </div>
        </template>
        <template #content>
          <p class="text-sm leading-6 text-slate-300">{{ item.body }}</p>
        </template>
      </Card>
    </template>
  </section>
</template>
