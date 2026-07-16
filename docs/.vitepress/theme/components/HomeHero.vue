<script setup lang="ts">
/**
 * HomeHero: renders the hero block and feature grid from the page's
 * `hero:` and `features:` frontmatter. Mounted in the `doc-before`
 * slot so home content uses `layout: doc` and gets the canonical
 * sidebar/topbar/footer layout that every other page uses. Nothing
 * renders if the frontmatter doesn't declare a hero.
 *
 * Frontmatter shape:
 *   hero:
 *     name: 'Dagonizer'
 *     text:  'short pitch'
 *     tagline: 'longer pitch'
 *     image: { src: '/icon.svg', alt: '...' }
 *     actions:
 *       - { theme: 'brand', text: 'Get Started', link: '/getting-started' }
 *       - { theme: 'alt',   text: 'GitHub',      link: 'https://...' }
 *   features:
 *     - { icon: 'λ', title: 'Type-safe nodes', details: '...' }
 *     - ...
 */

import { computed } from 'vue';
import { useData, withBase } from 'vitepress';
import UiActionLink from './ui/UiActionLink.vue';
import UiCtaRow from './ui/UiCtaRow.vue';
import UiFeatureCallout from './ui/UiFeatureCallout.vue';
import UiSectionIntro from './ui/UiSectionIntro.vue';

interface HeroImage {
  readonly src: string;
  readonly alt?: string;
}
interface HeroAction {
  readonly theme?: 'brand' | 'alt';
  readonly text: string;
  readonly link: string;
}
interface Hero {
  readonly name?:    string;
  readonly text?:    string;
  readonly tagline?: string;
  readonly image?:   HeroImage;
  readonly actions?: readonly HeroAction[];
}
interface Feature {
  readonly icon?:    string;
  readonly title:    string;
  readonly details?: string;
  readonly link?:    string;
}

const { frontmatter } = useData();

const hero     = computed<Hero | null>(() => frontmatter.value['hero'] ?? null);
const features = computed<readonly Feature[]>(() => frontmatter.value['features'] ?? []);

function resolve(link: string): string {
  return /^https?:/.test(link) ? link : withBase(link);
}
</script>

<template>
  <section v-if="hero" class="dagonizer-hero">
    <UiSectionIntro
      v-if="hero.name"
      class="hero-text"
      :title="hero.name"
      :lead="hero.text ?? null"
      :summary="hero.tagline ?? null"
      variant="standard"
    >
      <template v-if="hero.actions && hero.actions.length > 0" #actions>
        <UiCtaRow gap="sm">
          <UiActionLink
          v-for="a in hero.actions"
          :key="a.link"
          :href="resolve(a.link)"
          :variant="a.theme ?? 'brand'"
        >
          {{ a.text }}
          </UiActionLink>
        </UiCtaRow>
      </template>
    </UiSectionIntro>

    <div v-if="hero.image" class="hero-image">
      <img :src="resolve(hero.image.src)" :alt="hero.image.alt ?? ''" />
    </div>
  </section>

  <section v-if="features.length > 0" class="dagonizer-features">
    <UiFeatureCallout
      v-for="f in features"
      :key="f.title"
      class="dagonizer-feature"
      v-bind="f.link ? { href: resolve(f.link) } : {}"
      accent="cyan"
      :icon="f.icon ?? null"
      :title="f.title"
      :details="f.details ?? null"
    />
  </section>
</template>

<style scoped>
.dagonizer-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 2.5rem;
  align-items: center;
  padding: 1.5rem 0 2rem;
  border-bottom: 1px solid var(--vp-c-divider);
  margin-bottom: 2rem;
}

.hero-text { min-width: 0; }

.hero-image {
  flex-shrink: 0;
}
.hero-image img {
  width: clamp(120px, 18vw, 220px);
  height: auto;
  filter:
    drop-shadow(0 0 24px rgba(34, 232, 255, 0.35))
    drop-shadow(0 0 48px rgba(177, 140, 255, 0.18));
}

.dagonizer-features {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 1rem;
  margin: 1.5rem 0 2rem;
}

.dagonizer-feature {
  height: 100%;
}

@media (max-width: 720px) {
  .dagonizer-hero {
    grid-template-columns: 1fr;
    gap: 1.5rem;
    text-align: left;
  }
  .hero-image { order: -1; }
  .hero-image img { width: clamp(80px, 22vw, 140px); }
}
</style>
