<script setup lang="ts">
import { ref } from 'vue';
import Drawer from 'primevue/drawer';
import InputText from 'primevue/inputtext';
import UiActionLink from '@/components/islands/UiActionLink.vue';
import UiCtaRow from '@/components/islands/UiCtaRow.vue';
import UiFactTags from '@/components/islands/UiFactTags.vue';

const props = defineProps<{
  links: ReadonlyArray<{ label: string; href: string }>;
  homeHref: string;
  iconHref: string;
  ctaHref: string;
  repoUrl: string;
  docsHref: string;
}>();

const mobileOpen = ref(false);
const desktopSearchQuery = ref('');
const mobileSearchQuery = ref('');
const topFacts = ['Typed DAG runtime', 'Inspectable execution', 'Durable resume'] as const;

function closeDrawer() {
  mobileOpen.value = false;
}

function docsSearchHref(term: string): string {
  const trimmed = term.trim();
  return trimmed.length === 0 ? props.docsHref : `${props.docsHref}?q=${encodeURIComponent(trimmed)}`;
}

function submitDesktopSearch() {
  window.location.href = docsSearchHref(desktopSearchQuery.value);
}

function submitMobileSearch() {
  closeDrawer();
  window.location.href = docsSearchHref(mobileSearchQuery.value);
}
</script>

<template>
  <header class="sticky top-0 z-50">
    <div class="hex-shell bg-slate-950/86 px-4 py-3.5 shadow-[0_24px_80px_-44px_rgba(2,6,23,1)] backdrop-blur-xl md:px-6">
      <div class="flex items-center justify-between gap-4 lg:hidden">
        <a :href="homeHref" class="flex min-w-0 items-center gap-3.5">
          <img :src="iconHref" alt="Dagonizer" class="h-14 w-14" />
          <div class="min-w-0">
            <div class="truncate text-sm font-semibold uppercase tracking-[0.22em] text-slate-50">Dagonizer</div>
            <div class="truncate text-[11px] uppercase tracking-[0.18em] text-slate-400">Typed DAG orchestration</div>
          </div>
        </a>

        <button
          type="button"
          aria-label="Open navigation"
          class="inline-flex h-11 w-11 items-center justify-center text-slate-200 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/35"
          @click="mobileOpen = true"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="1.75">
            <path stroke-linecap="round" d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      </div>

      <div class="hidden flex-col gap-4 lg:flex">
        <div class="flex items-center justify-between gap-6 pb-3">
          <a :href="homeHref" class="flex min-w-0 items-center gap-3.5 pr-2">
            <img :src="iconHref" alt="Dagonizer" class="h-14 w-14" />
            <div class="min-w-0 space-y-1">
              <div class="truncate text-sm font-semibold uppercase tracking-[0.22em] text-slate-50">Dagonizer</div>
              <div class="truncate text-[11px] uppercase tracking-[0.18em] text-slate-400">Typed DAG orchestration</div>
            </div>
          </a>

          <UiFactTags :items="topFacts" />
        </div>

        <div class="hex-divider"></div>

        <div class="flex items-center justify-between gap-6 pt-1">
          <nav class="flex min-w-0 flex-1 flex-wrap items-center gap-x-6 gap-y-2" aria-label="Primary">
            <a
              v-for="link in links"
              :key="link.href"
              :href="link.href"
              class="group relative inline-flex items-center py-2 text-[15px] font-medium text-slate-300 transition hover:text-white"
            >
              <span>{{ link.label }}</span>
              <span
                aria-hidden="true"
                class="absolute inset-x-0 -bottom-px h-px bg-transparent transition duration-150 group-hover:bg-cyan-300/45"
              ></span>
            </a>
          </nav>

          <div class="flex shrink-0 items-center gap-4">
            <InputText
              v-model="desktopSearchQuery"
              placeholder="Search docs..."
              aria-label="Search docs"
              class="w-44 xl:w-56"
              @keydown.enter="submitDesktopSearch"
            />

            <UiCtaRow>
              <UiActionLink :href="ctaHref" variant="primary" label="Get started" />
              <UiActionLink :href="repoUrl" target="_blank" rel="noreferrer" label="GitHub" />
            </UiCtaRow>
          </div>
        </div>
      </div>

      <Drawer v-model:visible="mobileOpen" position="right" header="Dagonizer">
        <div class="flex flex-col gap-5">
          <InputText
            v-model="mobileSearchQuery"
            placeholder="Search docs..."
            aria-label="Search docs"
            class="w-full"
            @keydown.enter="submitMobileSearch"
          />

          <nav class="flex flex-col" aria-label="Primary">
            <a
              v-for="link in links"
              :key="link.href"
              :href="link.href"
              class="group flex items-center justify-between border-b border-white/8 py-3 text-base text-slate-200 transition hover:text-white"
              @click="closeDrawer"
            >
              <span>{{ link.label }}</span>
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                class="h-4 w-4 text-slate-500 transition group-hover:text-slate-300"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 3.5 9.5 8 5 12.5" />
              </svg>
            </a>
          </nav>

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
