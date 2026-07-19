<script setup lang="ts">
import Card from 'primevue/card';

defineProps<{
  eyebrow?: string;
  title: string;
  description: string;
}>();
</script>

<template>
  <Card class="hex-shell relative overflow-hidden">
    <template #content>
      <section class="relative px-8 py-10 md:px-12 md:py-14">
        <div class="absolute inset-y-0 right-0 hidden w-[44%] md:block xl:hidden">
          <slot name="visual" />
        </div>

        <div class="relative grid gap-8 xl:grid-cols-[minmax(0,1.05fr)_minmax(20rem,0.95fr)] xl:items-start">
          <div class="max-w-2xl space-y-6 md:max-w-none md:pr-[48%] xl:max-w-2xl xl:pr-0">
            <div v-if="eyebrow || $slots.eyebrow" class="flex flex-wrap items-center gap-3">
              <slot name="eyebrow">
                <span class="text-xs uppercase tracking-[0.28em] text-slate-500">{{ eyebrow }}</span>
              </slot>
            </div>

            <div class="space-y-4">
              <h1
                class="max-w-3xl text-4xl font-semibold tracking-tight md:text-6xl"
                style="color: var(--dagonizer-text);"
              >
                {{ title }}
              </h1>
              <p class="max-w-xl text-base leading-7 text-slate-300 md:text-lg">
                {{ description }}
              </p>
            </div>

            <div v-if="$slots.actions" class="flex flex-wrap gap-3">
              <slot name="actions" />
            </div>

            <div v-if="$slots.supporting" class="pt-2">
              <slot name="supporting" />
            </div>
          </div>

          <div class="relative hidden min-h-[26rem] xl:block">
            <slot name="visual" />
          </div>
        </div>
      </section>
    </template>
  </Card>
</template>
