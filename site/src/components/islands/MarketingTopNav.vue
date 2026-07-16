<script setup lang="ts">
import { computed, ref } from 'vue';
import Menubar from 'primevue/menubar';
import Menu from 'primevue/menu';
import Drawer from 'primevue/drawer';
import Button from 'primevue/button';
import UiActionLink from '@/components/islands/UiActionLink.vue';
import UiCtaRow from '@/components/islands/UiCtaRow.vue';
import UiFactTags from '@/components/islands/UiFactTags.vue';

const props = defineProps<{
  links: ReadonlyArray<{ label: string; href: string }>;
  homeHref: string;
  iconHref: string;
  ctaHref: string;
  repoUrl: string;
}>();

const mobileOpen = ref(false);

const navItems = computed(() => props.links.map((link) => ({ ...link })));
const mobileNavItems = computed(() =>
  props.links.map((link) => ({
    label: link.label,
    url: link.href,
    command: closeDrawer
  }))
);
const topFacts = ['Typed DAG runtime', 'Inspectable execution', 'Durable resume'] as const;

function closeDrawer() {
  mobileOpen.value = false;
}
</script>

<template>
  <header class="sticky top-0 z-50">
    <div class="rounded-[1.75rem] border border-white/10 bg-slate-950/88 px-4 py-3 shadow-[0_24px_80px_-44px_rgba(2,6,23,1)] backdrop-blur-xl md:px-5">
      <div class="flex items-center justify-between gap-4 lg:hidden">
        <a :href="homeHref" class="flex min-w-0 items-center gap-3">
          <div class="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/8 shadow-[0_0_0_1px_rgba(34,232,255,0.08)_inset]">
            <img :src="iconHref" alt="Dagonizer" class="h-8 w-8" />
          </div>
          <div class="min-w-0">
            <div class="truncate text-sm font-semibold uppercase tracking-[0.22em] text-slate-50">Dagonizer</div>
            <div class="truncate text-[11px] uppercase tracking-[0.18em] text-slate-400">Typed DAG orchestration</div>
          </div>
        </a>

        <Button
          label="Menu"
          severity="contrast"
          variant="outlined"
          @click="mobileOpen = true"
        />
      </div>

      <div class="hidden flex-col gap-3 lg:flex">
        <div class="flex items-center justify-between gap-6 border-b border-white/8 pb-3">
          <a :href="homeHref" class="flex min-w-0 items-center gap-3 pr-2">
            <div class="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/8 shadow-[0_0_0_1px_rgba(34,232,255,0.08)_inset]">
              <img :src="iconHref" alt="Dagonizer" class="h-8 w-8" />
            </div>
            <div class="min-w-0 space-y-1">
              <div class="truncate text-sm font-semibold uppercase tracking-[0.22em] text-slate-50">Dagonizer</div>
              <div class="truncate text-[11px] uppercase tracking-[0.18em] text-slate-400">Typed DAG orchestration</div>
            </div>
          </a>

          <UiFactTags :items="topFacts" />
        </div>

        <div class="flex items-center gap-5">
          <div class="min-w-0 flex-1">
            <Menubar :model="navItems">
              <template #item="{ item, props: itemProps }">
                <a
                  v-bind="itemProps.action"
                  :href="item.href"
                  class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-300 transition hover:bg-white/6 hover:text-white"
                >
                  <span>{{ item.label }}</span>
                </a>
              </template>
            </Menubar>
          </div>

          <UiCtaRow>
            <UiActionLink :href="ctaHref" variant="primary" label="Get started" />
            <UiActionLink :href="repoUrl" target="_blank" rel="noreferrer" label="GitHub" />
          </UiCtaRow>
        </div>
      </div>

      <Drawer v-model:visible="mobileOpen" position="right" header="Dagonizer">
        <div class="flex flex-col gap-3">
          <Menu :model="mobileNavItems">
            <template #item="{ item, props: itemProps }">
              <a
                v-bind="itemProps.action"
                :href="item.url"
                class="flex items-center rounded-xl px-4 py-3 text-sm font-medium text-slate-200 transition hover:text-white"
              >
                {{ item.label }}
              </a>
            </template>
          </Menu>

          <div class="mt-2">
            <UiFactTags :items="topFacts" />
          </div>

          <UiCtaRow class="mt-2 grid gap-2">
            <UiActionLink :href="ctaHref" variant="primary" label="Get started" block @click="closeDrawer" />
            <UiActionLink :href="repoUrl" target="_blank" rel="noreferrer" label="GitHub" block @click="closeDrawer" />
          </UiCtaRow>
        </div>
      </Drawer>
    </div>
  </header>
</template>
