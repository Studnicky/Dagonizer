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
    <div class="hero-text">
      <h1 v-if="hero.name" class="hero-name">{{ hero.name }}</h1>
      <p  v-if="hero.text"    class="hero-tagline">{{ hero.text }}</p>
      <p  v-if="hero.tagline" class="hero-subtitle">{{ hero.tagline }}</p>

      <div v-if="hero.actions && hero.actions.length > 0" class="hero-actions">
        <a
          v-for="a in hero.actions"
          :key="a.link"
          :href="resolve(a.link)"
          :class="['hero-action', `theme-${a.theme ?? 'brand'}`]"
        >
          {{ a.text }}
        </a>
      </div>
    </div>

    <div v-if="hero.image" class="hero-image">
      <img :src="resolve(hero.image.src)" :alt="hero.image.alt ?? ''" />
    </div>
  </section>

  <section v-if="features.length > 0" class="dagonizer-features">
    <component
      :is="f.link ? 'a' : 'div'"
      v-for="f in features"
      :key="f.title"
      :href="f.link ? resolve(f.link) : undefined"
      class="dagonizer-feature"
    >
      <div v-if="f.icon" class="feature-icon" aria-hidden="true">{{ f.icon }}</div>
      <h3 class="feature-title">{{ f.title }}</h3>
      <p v-if="f.details" class="feature-details">{{ f.details }}</p>
    </component>
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

.hero-name {
  font-family: var(--vp-font-family-display);
  font-size: clamp(2rem, 4vw, 3rem);
  font-weight: 800;
  letter-spacing: -0.03em;
  margin: 0 0 0.8rem;
  color: var(--dagonizer-silver, var(--vp-c-text-1));
  line-height: 1.1;
  border: 0;
  padding: 0;
}

.hero-tagline {
  font-family: var(--vp-font-family-display);
  font-size: clamp(1.05rem, 2vw, 1.4rem);
  color: var(--vp-c-text-1);
  margin: 0 0 0.6rem;
  line-height: 1.4;
  font-weight: 500;
}

.hero-subtitle {
  font-size: 0.95rem;
  color: var(--vp-c-text-2);
  margin: 0 0 1.4rem;
  line-height: 1.6;
  max-width: 60ch;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.hero-action {
  display: inline-block;
  padding: 0.6rem 1.2rem;
  font-weight: 600;
  font-size: 0.9rem;
  text-decoration: none;
  border: 1px solid transparent;
  border-radius: var(--dagonizer-surface-radius, 6px);
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.hero-action.theme-brand {
  background: var(--dagonizer-cyan, var(--vp-c-brand-1));
  color: var(--dagonizer-pearl, var(--vp-c-bg));
}
.hero-action.theme-brand:hover {
  background: var(--dagonizer-gold, var(--vp-c-brand-2));
  color: var(--dagonizer-pearl, var(--vp-c-bg));
}

.hero-action.theme-alt {
  background: transparent;
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-divider);
}
.hero-action.theme-alt:hover {
  border-color: var(--dagonizer-gold, var(--vp-c-brand-2));
  color: var(--dagonizer-gold, var(--vp-c-brand-2));
  background: rgba(212, 166, 73, 0.08);
}

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

/* Feature card uses the canonical surface treatment defined in base.css
   so it reads as the same family as code blocks, mermaid frames, and
   blockquotes. Only the gradient seam and hover behavior are unique. */
.dagonizer-feature {
  background-color: var(--dagonizer-surface-bg, var(--vp-c-bg-alt));
  background-image: var(--dagonizer-surface-grain);
  background-size: var(--dagonizer-surface-grain-size, 160px 160px);
  border: var(--dagonizer-surface-border, 1px solid var(--vp-c-divider));
  border-radius: var(--dagonizer-surface-radius, 6px);
  padding: 1rem 1.1rem;
  position: relative;
  text-decoration: none;
  color: inherit;
  transition: border-color 0.15s ease, transform 0.15s ease;
}

.dagonizer-feature[href]:hover {
  border-color: var(--dagonizer-cyan, var(--vp-c-brand-1));
  transform: translateY(-1px);
}

.dagonizer-feature::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: var(--dagonizer-surface-radius, 6px);
  padding: 1px 0 0;
  background: linear-gradient(135deg,
    var(--dagonizer-cyan, var(--vp-c-brand-1)),
    var(--dagonizer-seagreen, var(--vp-c-brand-2)),
    var(--dagonizer-violet, var(--vp-c-brand-3))
  );
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
}

.feature-icon {
  font-family: var(--vp-font-family-display);
  font-size: 1.6rem;
  color: var(--dagonizer-cyan, var(--vp-c-brand-1));
  margin-bottom: 0.35rem;
  line-height: 1;
}

.feature-title {
  font-family: var(--vp-font-family-display);
  font-size: 0.95rem;
  font-weight: 700;
  margin: 0 0 0.35rem;
  color: var(--dagonizer-cyan, var(--vp-c-brand-1));
}

.feature-details {
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
  margin: 0;
  line-height: 1.5;
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
